# iot-telemetry v0.1 spec (2026-10-04)

Lead: Claude Opus (plan, review). Builder: `sonnet-builder`. Design source: `taskarinchu/docs/devdocs/iot-telemetry.md`.
Portfolio bar: `taskarinchu/docs/superpowers/specs/2026-10-03-project-shortlist.md` (30-second wow, measured headline
number, something installable, honest ADRs, CI with tests).

## One line

A simulated vehicle fleet publishes telemetry over MQTT; the same IoT Rule SQL routes it locally (Mosquitto) and in AWS
(IoT Core, CDK); a pure, published alert core turns noisy, duplicated geofence events into exactly one alert per real
crossing; a live MapLibre map shows the fleet and the alerts.

## What v0.1 ships

1. **Fleet simulator** (`packages/sim`): N vehicles on synthetic loop routes around Munich, seeded PRNG, GPS jitter,
   speed/battery/odometer models, per-vehicle MQTT client with Last Will, crash-safe monotonic `seq`, scenarios
   `loiter` and `tunnel`, NDJSON record and deterministic replay with a virtual clock.
2. **Shared schema** (`packages/schema`): telemetry type + JSON Schema (ajv), topic helpers, fixtures, the three IoT
   Rule SQL statements as constants, and a small interpreter for the WHERE subset they use (AWS Undefined semantics).
3. **Alert core** (`packages/alert-core`): `step(state, event, config) -> { state, emitted, outcome }`. Pure, no clock,
   no IO, zero runtime dependencies. **Published as an npm package** (the installable artifact).
4. **Alert adapter** (`packages/alert-lambda`): maps Amazon Location EventBridge events to core events, loads/commits
   pair state with a version-conditioned DynamoDB transaction (state item + alert item together), publishes to SNS
   after commit, retries on conflict. Same code runs in Lambda (cloud) and in the local pipeline (with DynamoDB Local).
5. **Local pipeline** (`packages/local-pipeline`): the local stand-in for IoT Rules + Location. Subscribes to
   Mosquitto, routes each message with the shared rule SQL (valid -> history NDJSON + latest map + geofence stub;
   invalid -> quarantine NDJSON), turns positions into Location-shaped ENTER/EXIT events with turf.js (with an optional
   seeded duplicate-delivery rate to mimic EventBridge at-least-once), runs the alert adapter, and publishes alerts
   and the geofence GeoJSON over MQTT for the map.
6. **Web map** (`packages/web`): Vite + React + MapLibre GL. Live markers over MQTT-over-WebSockets, trail of the
   selected vehicle, geofence polygon from the retained `fleet/geofences` topic, alert timeline, live counters.
7. **Infra** (`infra`): CDK v2 stack, verified by `cdk synth` + assertion tests + cdk-nag v3 only (no AWS account, no
   LocalStack token). IoT device policy with thing-name policy variables, three topic rules through a `FleetTopicRule`
   construct that requires an error action, Firehose -> S3 history, DynamoDB latest-position table, Location tracker +
   geofence collection + consumer, EventBridge rules (geofence events and a 1-minute sweep) -> alert Lambda,
   DynamoDB `AlertState`, SNS `fleet-alerts`, S3 quarantine and rule-errors buckets, alarms on rule failures.
8. **Bench** (`bench`): measured latency and alert-correctness numbers written to `bench/results/latest.json`.
9. **Docker compose** demo, **CI** workflow, README with the measured headline, DEVDOCS, handoff.

Out of scope for v0.1 (v0.2+): real AWS deploy, certificates/provisioning, read API, Cognito, geofence editor,
`cmd` topic, Device Shadow, clock-skew scenario, InfluxDB, cloud load test, reorder buffer in the alert core.

## Contracts

### MQTT topics

| Topic | Direction | QoS | Retained | Payload |
|---|---|---|---|---|
| `fleet/{vehicleId}/telemetry` | sim -> broker | 1 | no | `Telemetry` JSON |
| `fleet/{vehicleId}/status` | sim -> broker | 1 | yes | `{"state":"online"\|"offline","ts":string}`; offline is the Last Will |
| `fleet/alerts` | pipeline -> map | 1 | no | `Alert` JSON (from alert-core) |
| `fleet/geofences` | pipeline -> map | 1 | yes | GeoJSON `FeatureCollection` of geofence polygons (`properties.id`, `properties.name`) |

### Telemetry payload

```json
{ "v": 1, "vehicleId": "veh-0042", "seq": 18234, "ts": "2026-10-03T09:15:02.000Z", "lat": 48.13743,
  "lon": 11.57549, "speedKph": 47.2, "headingDeg": 182, "odometerKm": 12034.6, "batteryPct": 71.5, "ignition": true }
```

JSON Schema: all 11 fields required, `additionalProperties: false`, `v` const 1, `vehicleId` `^veh-[0-9]{4}$`,
`seq` integer >= 0, `ts` matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`, `lat` [-90, 90], `lon` [-180, 180],
`speedKph` [0, 300], `headingDeg` [0, 360), `odometerKm` >= 0, `batteryPct` [0, 100], `ignition` boolean.

### Rule SQL (one source for local and cloud)

```
VALID = get_or_default(v = 1 AND vehicleId = topic(2) AND seq >= 0 AND lat >= -90 AND lat <= 90 AND lon >= -180
        AND lon <= 180 AND time_to_epoch(ts, "yyyy-MM-dd'T'HH:mm:ss.SSSX") > 0, false)
telemetry_to_history:   SELECT *, time_to_epoch(ts, "yyyy-MM-dd'T'HH:mm:ss.SSSX") AS tsMs FROM 'fleet/+/telemetry' WHERE VALID
position_to_location:   SELECT vehicleId, lat, lon, ts FROM 'fleet/+/telemetry' WHERE VALID
invalid_to_quarantine:  SELECT *, topic() AS topic, timestamp() AS receivedAt FROM 'fleet/+/telemetry' WHERE NOT VALID
```

Why `get_or_default`: per the AWS IoT SQL operator tables (checked 2026-10-04), `AND`/`OR`/`NOT` return Undefined for
any non-Boolean operand and comparisons with an Undefined operand return Undefined; a WHERE that is Undefined does not
match. Without the wrapper, a payload missing `lat` would match neither rule and vanish. `get_or_default(expr, false)`
returns `false` when `expr` is Undefined or fails, so VALID is always Boolean and the two rules are exact complements.
IoT SQL has no `isNumber`/`isString` and no `BETWEEN`, so the SQL is a coarse gate; ajv is the strict check.
`vehicleId = topic(2)` stops a device from writing telemetry under another vehicle's id (the IoT policy already limits
which topic it may publish to). The local pipeline routes **only** by this SQL, exactly like the cloud; ajv failures on
SQL-valid messages are counted (`schemaViolations`), not dropped.

### Alert core semantics (the thesis)

Per (vehicleId, geofenceId) pair. Config: `dwellMs` (default 60 000), `minExitMs` (default 30 000).
Events: `ENTER`/`EXIT` (with `eventId`, `deviceTs`) and `TICK` (`deviceTs` only).

- The confirmed state follows a **debounced raw signal**: a vehicle is confirmed INSIDE once the raw signal has been
  continuously inside for `dwellMs`, and confirmed OUTSIDE once it has been continuously outside for `minExitMs`.
- States: `OUTSIDE`, `PENDING_IN`, `INSIDE`, `PENDING_OUT`. `ENTERED` is emitted on PENDING_IN -> INSIDE with
  `confirmedAt = since + dwellMs`; `EXITED` on PENDING_OUT -> OUTSIDE with `confirmedAt = since + minExitMs`.
- Every step first confirms a pending state if `event.deviceTs - since >= threshold`, then applies the event, then
  confirms again (so a threshold of 0 confirms immediately).
- **Late:** an event with `deviceTs < lastEventTs` returns the state unchanged (`late_ignored`).
- **Duplicate:** an ENTER/EXIT whose `eventId` is in `idsAtLastTs` (ids already applied at `deviceTs == lastEventTs`)
  returns the state unchanged (`duplicate`). Because older events are already dropped as late, this catches every
  redelivery without an unbounded id set.
- **Redundant:** ENTER while PENDING_IN/INSIDE, EXIT while OUTSIDE/PENDING_OUT: no transition, outcome `redundant`
  (timestamps still advance).
- TICK never advances `lastEventTs`; a TICK older than `since` is a no-op.
- A transition sets `since = max(event.deviceTs, previous since)`. Without this clamp, a wall-clock TICK that confirms
  ENTERED ahead of event time followed by an earlier EXIT yields an EXITED with a smaller `confirmedAt` (a prototype
  property run on 2026-10-04 found 25 such violations in 3 000 timelines; 0 with the clamp).
- `alertId = "{vehicleId}:{geofenceId}:{type}:{confirmedAt}"` (deterministic; the DynamoDB alert item key).
- No `Date`, `Math.random`, `node:*` or `@aws-sdk/*` in the package (ESLint-enforced and tested).

Reference model (test-only, written differently on purpose): dedupe by eventId, stable sort by deviceTs, build raw
inside/outside segments up to a horizon, then walk segments with the two thresholds. For sorted delivery with any
duplicates inserted after their original, `run()` must equal the reference.

Under arbitrary reordering the core guarantees safety, not completeness: alerts per pair alternate
ENTERED/EXITED starting with ENTERED, `confirmedAt` never decreases, alert ids are unique, and a late event never changes
state. Events dropped as late are counted and reported, never hidden.

### Ticks

- Local: every valid telemetry message is a TICK (at its `ts`) for that vehicle's pending pairs. Deterministic, no timers.
- Cloud: EventBridge rule `rate(1 minute)` invokes the alert Lambda with `{"source":"iot-telemetry.sweep"}`; it queries
  the sparse GSI `pending-index` and TICKs each pending pair at `Date.now()` (adapter only). Dwell confirmation in the
  cloud can lag by up to 60 s (ADR 0005).

### Storage

- `AlertState` (DynamoDB, single table, `pk`/`sk` strings):
  - state item `pk=VEH#{vehicleId}`, `sk=GF#{geofenceId}`: `status`, `since`, `lastEventTs`, `idsAtLastTs` (list),
    `version` (number), `pending` (`"1"` only while PENDING_IN/PENDING_OUT; key of sparse GSI `pending-index`, sort key `pk`).
  - alert item `pk=VEH#{vehicleId}`, `sk=ALERT#{confirmedAt zero-padded to 15}#{geofenceId}#{type}`: `alertId`, `type`,
    `confirmedAt`, `triggerEventId`.
  - Commit = `TransactWriteItems`: state Put with `attribute_not_exists(pk)` (version 0) or `version = :expected`, plus
    one Put per emitted alert with `attribute_not_exists(pk)`. `TransactionCanceledException` -> conflict -> reload,
    re-step (max 5 attempts). Prototyped against `amazon/dynamodb-local:3.3.1` on 2026-10-04: two racing commits ->
    one fulfilled, one `TransactionCanceledException` with reasons `ConditionalCheckFailed`.
- History (cloud): Firehose -> S3 NDJSON. Latest position (cloud): DynamoDB `Latest` table via the IoT `dynamoDBv2` action.
- History (local): `var/history/dt=YYYY-MM-DD/hour=HH.ndjson`; quarantine: `var/quarantine/dt=YYYY-MM-DD.ndjson`.

## Ports and names (shared machine)

Host ports **5370-5379 only**: 5370 MQTT (TCP), 5371 MQTT over WebSockets, 5372 DynamoDB Local, 5373 web.
Compose project `iot-telemetry`; every container name starts with `iot-telemetry-`.

## Metrics (all measured, written to `bench/results/latest.json`)

| Metric | How |
|---|---|
| Publish -> MQTT-WS subscriber latency p50/p95/p99/max | `bench latency`: 200 vehicles at 1 Hz for 60 s through the sim engine; publish time and receive time from `performance.now()` in one process; subscriber uses WebSockets (the browser path). Also `sent`, `received`. |
| Alert correctness under duplicate delivery | `bench alerts`: 1 000 seeded random timelines with duplicate deliveries; counts naive alerts (one per raw ENTER delivery), core alerts, reference crossings, duplicates (core minus reference, by id), misses. |
| Reordering behavior | Same timelines shuffled within a 10 s window: invariant violations (must be 0), `late_ignored` count, alerts missed vs reference (reported as is). |
| Loiter scenario | `loiter` replayed through the pipeline: naive alert count vs core alert count (expected core: exactly 1 ENTERED, 1 EXITED). |

README headline template (numbers filled only from `latest.json`):
"200 simulated vehicles at 1 Hz: p99 {p99Ms} ms publish-to-subscriber over MQTT-WS. Across 1,000 fuzzed geofence
timelines with duplicate deliveries, naive alerting fired {naiveAlerts} alerts; the alert core fired exactly the
{referenceCrossings} real crossings (0 duplicates, 0 missed)." If a measured value contradicts the template (for example
duplicates > 0), the README states the measured value and the template changes, never the number.

## Gates

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test                    # unit + property; integration files skip without env vars
pnpm build
pnpm synth                   # cdk synth with cdk-nag v3 (AwsSolutions); exit 0
pnpm --filter @iot-telemetry/alert-core pack --dry-run   # tarball lists dist/, README.md, LICENSE, package.json only
docker compose up -d --wait mosquitto dynamodb
$env:IOT_IT_MQTT_URL='mqtt://localhost:5370'; $env:IOT_IT_MQTT_WS_URL='ws://localhost:5371'; $env:IOT_IT_DYNAMO_URL='http://localhost:5372'; pnpm test:int
docker compose down
docker compose build
```

## Constraints

- Node 24 (host has v24.18.0) and pnpm 9.12.0 on the host; Docker Desktop 29.5 for services. No Go needed.
- TypeScript **6.0.3** (not 7.x): `typescript-eslint@8.71.0` declares `typescript >=4.8.4 <6.1.0`.
- cdk-nag **v3** API: `Validations.of(app).addPlugins(new AwsSolutionsChecks(app))`; acknowledge with
  `Validations.of(construct).acknowledge({ id, reason })`. Any AwsSolutions finding makes `app.synth()` throw.
- No secrets in the repo. No AWS credentials are used anywhere. Integration tests skip unless their env var is set.
- Never invent numbers. Commits local only; never push or add remotes.
