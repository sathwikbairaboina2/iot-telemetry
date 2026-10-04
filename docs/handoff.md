
## 2026-10-04 - Claude (Sonnet builder) - main

What changed (v0.1, 24 plan tasks, one local commit each, nothing pushed):
- `packages/schema`: telemetry type and JSON Schema (ajv), fixtures, topic helpers, the three rule SQL constants and an IoT SQL WHERE-subset interpreter.
- `packages/alert-core`: pure `step`/`run` state machine, independent reference model, property tests, publishable package (LICENSE, README, dist only).
- `packages/sim`: seeded fleet simulator, crash-safe `seq` blocks, loiter and tunnel scenarios, MQTT sink with Last Will, NDJSON record/replay, CLI.
- `packages/alert-lambda`: Location event mapping, optimistic-concurrency handler, in-memory and DynamoDB repositories, SNS publisher, Lambda entry with 1-minute sweep, esbuild bundle.
- `packages/local-pipeline`: geofence stub, shared-SQL router, pipeline core, golden scenarios, MQTT wiring.
- `packages/web`: Vite + React + MapLibre live map, Playwright e2e, `docs/media/map.png`.
- `infra`: CDK `FleetStack`, `FleetTopicRule`, device policy, cdk-nag AwsSolutions gate.
- `bench`: latency and alert-correctness benchmark; results in `bench/results/latest.json`.
- Docker compose stack on ports 5370-5373, CI workflow, README, LICENSE.

What is left (v0.2): real AWS deploy, certificates and provisioning, read API, Cognito, geofence editor, `cmd` topic, Device Shadow, clock-skew scenario, InfluxDB, cloud load test, reorder buffer in the alert core, SNS publish retry after commit, README/DEVDOCS polish by the lead.

How to verify: the Gates block in the README "Development" section, then `docker compose up -d --build` and open http://localhost:5373. For the e2e: `docker compose --profile e2e run --rm e2e`. For the benchmark: `docker compose --profile bench run --rm bench`.

Measured headline (bench/results/latest.json, compose, 2026-10-03T23:43:55Z): 200 vehicles at 1 Hz, sent 12000, received 12000, p99 8.8154296875 ms. 1000 timelines: naive 7497 vs core 4223 = reference 4223, duplicates 0, missed 0. Reorder within 10 s: 0 invariant violations, 183 late drops, 42 crossings missed.

## 2026-10-04 - Claude (Sonnet builder, resume) - main

What changed: committed the review fixes left by a crashed run. The bench timelines now alternate ENTER/EXIT and the README numbers were re-measured. SNS notifications are documented as at-most-once. The device policy gained `iot:RetainPublish` on the status topic. The sweep isolates failing pairs, and the local pipeline seeds its pending index on restart. Added `docs/DEVDOCS.md`. `docs/handoff.md` had been zero-filled by the crash and was restored from git.

What is left: v0.2 items above; sim vitest timeout raised to 30 s after one unexplained flaky failure of the ndjson test.

How to verify: README "Development" gates; test totals 175 passed / 7 skipped; `test:int` 7 passed.

## 2026-10-04 - Claude (Opus lead, verify) - main

What changed: reviewed the review-fix diff (c44f1a6..bd46977). Fixed one bug: the local pipeline cached a rejected restart seed (`repo.listPending()`), so one DynamoDB hiccup at startup made every later message fail until restart. It now retries the seed on the next message (regression test added). DEVDOCS now covers all eight ADRs, with accurate e2e notes. `docs/media/map.png` was refreshed by the e2e run.

What is left: v0.2 list in DEVDOCS section 7 (real AWS deploy and certificates, read API, Cognito, outbox for SNS, reorder buffer, Device Shadow). There is no AWS deploy proof (no LocalStack token). The bench was not re-run this session; README numbers match `bench/results/latest.json` (2026-10-04T00:37Z). The sim ndjson test timeout is raised to 30 s; its one flaky failure was not reproduced.

How to verify (real output this session): install --frozen-lockfile ok; lint ok; typecheck ok; test 176 passed / 7 skipped; build exit 0; synth exit 0; pack:check 13 files; test:int 7 passed (Mosquitto + DynamoDB Local); compose build (all profiles) exit 0; e2e 1 passed (57.3 s); smoke: web 200, pipeline logged "ALERT ENTERED veh-0049 depot-north"; compose down, no iot-telemetry containers left.
