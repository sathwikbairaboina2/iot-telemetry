# iot-telemetry v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local, demoable vehicle-telemetry slice: a seeded MQTT fleet simulator, one rule SQL shared by a local pipeline and a CDK IoT Core stack, a pure published alert core that emits exactly one alert per real geofence crossing, a live MapLibre map, and a benchmark whose measured numbers go in the README.

**Architecture:** pnpm workspace of small ESM TypeScript packages. `schema` (types, JSON Schema, rule SQL + interpreter) and `alert-core` (pure state machine) sit at the bottom. `alert-lambda` adapts Location events to the core and persists state with DynamoDB transactions. `sim` publishes telemetry; `local-pipeline` stands in for IoT Rules + Amazon Location; `web` renders the live map; `infra` is the cloud stack proven by synth; `bench` measures. Docker compose runs Mosquitto, DynamoDB Local and the demo.

**Tech Stack:** Node 24 (host v24.18.0), pnpm 9.12.0, TypeScript 6.0.3, Vitest 5.0.3 + Vite 8.3.2, fast-check 4.10.2, ajv 8.20.0, mqtt 5.16.0, @turf/boolean-point-in-polygon 7.4.0 + @turf/helpers 7.4.0, @aws-sdk/client-dynamodb + @aws-sdk/lib-dynamodb + @aws-sdk/client-sns 3.1146.0, esbuild 0.28.2, tsx 4.23.15, React 19.3.0, maplibre-gl 6.12.0, @vitejs/plugin-react 6.1.1, aws-cdk-lib 2.272.0, aws-cdk 2.1144.0, constructs 10.8.1, cdk-nag 3.0.2, ESLint 10.12.0 + @eslint/js 10.0.1 + typescript-eslint 8.71.0 + globals 17.13.0, @playwright/test 1.63.0, @types/node 24.19.1, @types/aws-lambda 8.10.164, @types/react 19.3.0, @types/react-dom 19.3.0. Docker: `eclipse-mosquitto:2.1.2-alpine`, `amazon/dynamodb-local:3.3.1`, `node:24-bookworm-slim`, `mcr.microsoft.com/playwright:v1.63.0-noble`. All versions were checked to exist on 2026-10-04.

**Spec:** `docs/superpowers/specs/2026-10-04-iot-telemetry.md`. Decisions: `docs/adr/0001`-`0008`. Ledger: `.superpowers/sdd/2026-10-04-iot-telemetry/progress.md`.

## Global Constraints

- Repo root: `C:\Users\sathwik\projects\taskarinchu\iot-telemetry` (own git repo, branch `main`). Never touch sibling directories under `taskarinchu/`.
- Package scope `@iot-telemetry/*`. ESM only (`"type": "module"`), `moduleResolution: "NodeNext"`, so relative imports end in `.js`.
- Every workspace package's `package.json` `exports["."]` is `{ "source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }`. Each package's `vitest.config.ts` sets `resolve.conditions` and `ssr.resolve.conditions` to `["source"]`; `tsconfig.base.json` sets `"customConditions": ["source"]`. (Prototyped 2026-10-04: vitest and tsc resolve sibling `src/` with no build.)
- Pin exact versions (no `^`) from the Tech Stack line. Every package that runs `vitest`/`tsc` lists `vitest`, `typescript`, `@types/node` in its own devDependencies.
- TypeScript **6.0.3**, not 7.x (ADR 0007). cdk-nag v3 API only: `Validations.of(app).addPlugins(new AwsSolutionsChecks(app))`, acknowledge with `Validations.of(scope).acknowledge({ id, reason })`.
- Host ports **5370-5379 only**: 5370 MQTT TCP, 5371 MQTT WebSockets, 5372 DynamoDB Local, 5373 web. Compose project `iot-telemetry`, every `container_name` starts with `iot-telemetry-`. Stop everything you start (`docker compose down`).
- Integration tests are named `*.int.test.ts` and use `describe.skipIf(!process.env.X)` with `IOT_IT_MQTT_URL` (`mqtt://localhost:5370`), `IOT_IT_MQTT_WS_URL` (`ws://localhost:5371`), `IOT_IT_DYNAMO_URL` (`http://localhost:5372`). Without the env var they skip cleanly.
- mqtt.js clients keep the Node process alive: tests always `await client.endAsync()` and use `reconnectPeriod: 0`.
- `packages/alert-core/src` must not use `Date`, `Math.random`, `performance`, `process`, timers, `node:*` or `@aws-sdk/*`, and the package has no runtime `dependencies`.
- No AWS credentials anywhere. No secrets. `.env*` is gitignored. Never invent a number: README numbers come from `bench/results/latest.json`.
- Commits: local only, one per task, conventional subject, body ends with a blank line then `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Run `git status --short` and stage explicit paths. Never push, never add remotes, never amend. If a permission check blocks `git commit`, do not work around it: write a `Ruling:` line in the ledger and continue.
- Ledger: after each task append `Task N: complete (tests: <command> -> <real result>)`; decisions go in as `Ruling: <decision> - <why> - <cost>`.
- Commands below are PowerShell from the repo root unless marked otherwise.

## Review Focus

1. **Duplicate geofence event redelivered after other events with the same timestamp.** Must be `duplicate`, never a second transition. Test: `step.test.ts` "redelivery at the same timestamp after another event is a duplicate" (Task 4) and the dedupe property (Task 5).
2. **Wall-clock TICK ahead of event time, then an earlier EXIT.** `confirmedAt` must never decrease. Test: `ordering.property.test.ts` "ticks at arbitrary times keep confirmedAt monotonic" (Task 5). A prototype without the `since` clamp failed this 25 times in 3 000 runs.
3. **Payload missing a field or with a wrong type.** Must land in quarantine, never vanish. Test: `rules.property.test.ts` "VALID and NOT VALID are exact complements for arbitrary JSON" (Task 3).
4. **Two Lambda invocations racing on one pair.** Exactly one alert record and one publish. Tests: `concurrency.test.ts` (Task 10), `concurrency.int.test.ts` against DynamoDB Local (Task 11).
5. **Tunnel outage across a geofence entry.** Replayed buffered telemetry must yield the same alerts as an uninterrupted run, and `seq` has no gaps. Test: `scenarios.golden.test.ts` "tunnel" (Task 14).

## File Structure

```
iot-telemetry/
  package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json, eslint.config.js, .gitignore, .gitattributes,
  .dockerignore, .nvmrc, LICENSE, README.md
  data/routes/munich.geojson              generated by scripts/gen-routes.ts (seed 42), committed
  data/geofences/depot-north.geojson      hand-written rectangle, committed
  scripts/gen-routes.ts
  packages/schema/        src/{index,telemetry,topics,iot-sql,rules}.ts, fixtures/{valid,invalid}/*.json, test/*.test.ts
  packages/alert-core/    src/{index,types,step,run,reference}.ts, test/*.test.ts, README.md, LICENSE, tsconfig.build.json
  packages/alert-lambda/  src/{index,location-event,repo,memory-repo,dynamo-repo,handle,sns-publisher,lambda}.ts, scripts/bundle.mjs, test/*.test.ts
  packages/sim/           src/{index,prng,geo,routes,seq,vehicle,scenarios,clock,fleet,mqtt-sink,ndjson,cli}.ts, test/*.test.ts
  packages/local-pipeline/ src/{index,geofence-stub,router,sinks,pipeline,main}.ts, test/*.test.ts, test/golden/*.json
  packages/web/           index.html, vite.config.ts, playwright.config.ts, src/{main,App,state,feed,FleetMap,AlertTimeline}.tsx|ts, src/styles.css, test/state.test.ts, e2e/map.spec.ts
  infra/                  cdk.json, bin/app.ts, lib/{fleet-stack,fleet-topic-rule,device-policy}.ts, test/*.test.ts
  bench/                  src/{index,stats,timelines,alerts-bench,latency-bench,run}.ts, test/*.test.ts, results/latest.json
  docker/node.Dockerfile, docker/e2e.Dockerfile, docker/mosquitto/mosquitto.conf, docker-compose.yml
  .github/workflows/ci.yml
  docs/ (spec, plan, adr/, media/map.png, DEVDOCS.md, handoff.md)
```

---

### Task 1: Workspace scaffold, lint purity rules, smoke test

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.gitattributes`, `.nvmrc`, `.dockerignore`
- Create: `packages/alert-core/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,test/smoke.test.ts}`
- `.gitignore` already exists (do not remove entries).

**Interfaces:** Produces the conventions every later package copies: `package.json` shape, `tsconfig.json` extending the base, `vitest.config.ts`.

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "iot-telemetry",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=24" },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "pnpm -r --workspace-concurrency=1 run typecheck",
    "test": "pnpm -r --workspace-concurrency=1 run test",
    "test:int": "pnpm -r --workspace-concurrency=1 run test:int",
    "build": "pnpm -r run build",
    "synth": "pnpm --filter @iot-telemetry/infra run synth",
    "bench": "pnpm --filter @iot-telemetry/bench run bench",
    "sim": "node packages/sim/dist/cli.js",
    "gen:routes": "tsx --conditions=source scripts/gen-routes.ts"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "24.19.1",
    "eslint": "10.12.0",
    "globals": "17.13.0",
    "tsx": "4.23.15",
    "typescript": "6.0.3",
    "typescript-eslint": "8.71.0"
  },
  "pnpm": { "onlyBuiltDependencies": ["esbuild"] }
}
```
`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "infra"
  - "bench"
```
`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "customConditions": ["source"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "types": ["node"]
  }
}
```
`.nvmrc`: `24`. `.gitattributes`: `* text=auto eol=lf`. `.dockerignore`: `node_modules`, `**/node_modules`, `**/dist`, `**/dist-lambda`, `**/cdk.out`, `var`, `.git`, `.superpowers`, `**/test-results`, `**/playwright-report`.

`eslint.config.js`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

const pure = 'alert-core is pure: time and randomness arrive as event fields';

export default defineConfig(
  { ignores: ['**/dist/**', '**/dist-lambda/**', '**/cdk.out/**', '**/node_modules/**', 'var/**', '**/test-results/**', '**/playwright-report/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  {
    files: ['packages/alert-core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error',
        { name: 'Date', message: pure }, { name: 'performance', message: pure }, { name: 'process', message: pure },
        { name: 'setTimeout', message: pure }, { name: 'setInterval', message: pure }],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: pure }],
      'no-restricted-imports': ['error', { patterns: [{ group: ['node:*', '@aws-sdk/*', 'fs', 'path', 'crypto'], message: pure }] }],
    },
  },
);
```

- [ ] **Step 2: First package skeleton** (`packages/alert-core`)

`package.json`:
```json
{
  "name": "@iot-telemetry/alert-core",
  "version": "0.1.0",
  "description": "Pure geofence alert state machine: dwell, hysteresis, dedupe and late-event handling, one alert per real crossing.",
  "license": "MIT",
  "type": "module",
  "exports": { ".": { "source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:int": "vitest run .int.test --passWithNoTests"
  },
  "devDependencies": { "@types/node": "24.19.1", "fast-check": "4.10.2", "typescript": "6.0.3", "vitest": "5.0.3", "vite": "8.3.2" }
}
```
`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src", "test"] }`
`tsconfig.build.json`: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src", "noEmit": false }, "include": ["src"] }`
`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: { include: ['test/**/*.test.ts'] },
});
```
`src/index.ts`: `export const VERSION = '0.1.0';`
`test/smoke.test.ts`:
```ts
import { expect, test } from 'vitest';
import { VERSION } from '../src/index.js';
test('package loads', () => { expect(VERSION).toBe('0.1.0'); });
```

- [ ] **Step 3: Install and run**

Run: `pnpm install` then `pnpm test`, `pnpm typecheck`, `pnpm lint`
Expected: install creates `pnpm-lock.yaml`; `Test Files  1 passed (1)`; typecheck and lint exit 0.

- [ ] **Step 4: Prove the purity rule bites**

Temporarily add `export const now = () => Date.now();` to `packages/alert-core/src/index.ts`, run `pnpm lint`.
Expected: error `alert-core is pure: time and randomness arrive as event fields` (no-restricted-globals). Remove the line; `pnpm lint` exits 0.

- [ ] **Step 5: Commit** `chore: scaffold pnpm workspace with purity lint rules`

---

### Task 2: schema - telemetry type, JSON Schema, fixtures

**Files:**
- Create: `packages/schema/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}` (same shape as alert-core; name `@iot-telemetry/schema`, `"private": true`, dependencies `{"ajv": "8.20.0"}`, devDependencies add `fast-check`)
- Create: `packages/schema/src/telemetry.ts`, `packages/schema/src/index.ts`
- Create: `packages/schema/fixtures/valid/{basic.json,edge-ranges.json}`, `packages/schema/fixtures/invalid/{missing-lat.json,lat-out-of-range.json,lat-string.json,wrong-version.json,extra-field.json,bad-ts.json,vehicle-mismatch.json}`
- Test: `packages/schema/test/telemetry.test.ts`

**Interfaces:**
- Produces: `interface Telemetry { v: 1; vehicleId: string; seq: number; ts: string; lat: number; lon: number; speedKph: number; headingDeg: number; odometerKm: number; batteryPct: number; ignition: boolean }`, `telemetrySchema`, `validateTelemetry(x: unknown): { ok: true; value: Telemetry } | { ok: false; errors: string[] }`, `loadFixtures(kind: 'valid' | 'invalid'): Array<{ name: string; topic: string; payload: unknown }>` (exported from `src/fixtures.ts` for tests in other packages; reads `../fixtures` relative to `import.meta.url`).

Fixture file format (so rule tests can use the topic): `{ "topic": "fleet/veh-0042/telemetry", "payload": { ... } }`. `vehicle-mismatch.json` has topic `fleet/veh-0001/telemetry` and payload `vehicleId: "veh-0042"`; it is schema-valid but rule-invalid (used in Task 3). `edge-ranges.json`: `lat: -90, lon: 180, speedKph: 0, headingDeg: 359.9, batteryPct: 100`.

- [ ] **Step 1: Failing test**
```ts
import { describe, expect, test } from 'vitest';
import { validateTelemetry, loadFixtures } from '../src/index.js';

describe('validateTelemetry', () => {
  test.each(loadFixtures('valid'))('accepts $name', ({ payload }) => {
    expect(validateTelemetry(payload)).toEqual({ ok: true, value: payload });
  });
  const schemaInvalid = loadFixtures('invalid').filter((f) => f.name !== 'vehicle-mismatch');
  test.each(schemaInvalid)('rejects $name', ({ payload }) => {
    const r = validateTelemetry(payload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });
  test('vehicle-mismatch is schema-valid (the topic check lives in rule SQL)', () => {
    const f = loadFixtures('invalid').find((x) => x.name === 'vehicle-mismatch')!;
    expect(validateTelemetry(f.payload).ok).toBe(true);
  });
  test('headingDeg 360 is rejected (exclusive max)', () => {
    const base = loadFixtures('valid')[0]!.payload as Record<string, unknown>;
    expect(validateTelemetry({ ...base, headingDeg: 360 }).ok).toBe(false);
  });
});
```
- [ ] **Step 2:** `pnpm --filter @iot-telemetry/schema test` -> FAIL (module not found).
- [ ] **Step 3: Implement** `src/telemetry.ts` with `import { Ajv, type JSONSchemaType } from 'ajv'` (ajv 8 ESM: if the named import fails at runtime use `import AjvModule from 'ajv'; const Ajv = AjvModule.default ?? AjvModule;` and record a Ruling). Schema exactly as the spec's "Telemetry payload" section: all fields required, `additionalProperties: false`, `v: { type: 'integer', const: 1 }`, `vehicleId` pattern `^veh-[0-9]{4}$`, `seq` integer minimum 0, `ts` pattern `^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`, `lat` -90..90, `lon` -180..180, `speedKph` 0..300, `headingDeg` minimum 0 exclusiveMaximum 360, `odometerKm` minimum 0, `batteryPct` 0..100, `ignition` boolean. Compile once with `new Ajv({ allErrors: true, strict: true })`. Errors are formatted `${instancePath || '/'} ${message}`. `src/fixtures.ts` uses `node:fs` `readdirSync` sorted by name.
- [ ] **Step 4:** `pnpm --filter @iot-telemetry/schema test` -> all pass; `pnpm typecheck` exit 0.
- [ ] **Step 5: Commit** `feat(schema): telemetry JSON Schema, validator and fixtures`

---

### Task 3: schema - topics, IoT SQL WHERE interpreter, shared rule SQL

**Files:**
- Create: `packages/schema/src/topics.ts`, `packages/schema/src/iot-sql.ts`, `packages/schema/src/rules.ts`; export all from `src/index.ts`
- Test: `packages/schema/test/topics.test.ts`, `packages/schema/test/iot-sql.test.ts`, `packages/schema/test/rules.property.test.ts`

**Interfaces:**
- Produces (`topics.ts`): `telemetryTopic(id: string): string` (`fleet/${id}/telemetry`), `statusTopic(id)`, `TELEMETRY_FILTER = 'fleet/+/telemetry'`, `STATUS_FILTER = 'fleet/+/status'`, `ALERTS_TOPIC = 'fleet/alerts'`, `GEOFENCES_TOPIC = 'fleet/geofences'`, `parseTelemetryTopic(topic: string): string | null`.
- Produces (`iot-sql.ts`): `type SqlValue = number | string | boolean | null | SqlValue[] | { [k: string]: SqlValue } | typeof UNDEFINED`; `const UNDEFINED: unique symbol`; `evaluateWhere(where: string, payload: unknown, ctx: { topic: string }): boolean` (true only when the expression evaluates to Boolean `true`); `evaluateExpression(expr, payload, ctx): SqlValue` (exported for tests).
- Produces (`rules.ts`): `TS_PATTERN = "yyyy-MM-dd'T'HH:mm:ss.SSSX"`, `VALID_TELEMETRY_PREDICATE`, `TELEMETRY_TO_HISTORY_SQL`, `POSITION_TO_LOCATION_SQL`, `INVALID_TO_QUARANTINE_SQL`, `whereClause(sql: string): string` (text after the first top-level ` WHERE `), `classifyTelemetry(topic: string, payload: unknown): 'valid' | 'quarantine'`.

```ts
export const TS_PATTERN = "yyyy-MM-dd'T'HH:mm:ss.SSSX";
export const VALID_TELEMETRY_PREDICATE =
  `get_or_default(v = 1 AND vehicleId = topic(2) AND seq >= 0 AND lat >= -90 AND lat <= 90 ` +
  `AND lon >= -180 AND lon <= 180 AND time_to_epoch(ts, "${TS_PATTERN}") > 0, false)`;
export const TELEMETRY_TO_HISTORY_SQL =
  `SELECT *, time_to_epoch(ts, "${TS_PATTERN}") AS tsMs FROM 'fleet/+/telemetry' WHERE ${VALID_TELEMETRY_PREDICATE}`;
export const POSITION_TO_LOCATION_SQL =
  `SELECT vehicleId, lat, lon, ts FROM 'fleet/+/telemetry' WHERE ${VALID_TELEMETRY_PREDICATE}`;
export const INVALID_TO_QUARANTINE_SQL =
  `SELECT *, topic() AS topic, timestamp() AS receivedAt FROM 'fleet/+/telemetry' WHERE NOT ${VALID_TELEMETRY_PREDICATE}`;
```

Interpreter semantics (from the AWS IoT SQL operator tables, checked 2026-10-04; keep this table as a comment at the top of `iot-sql.ts` and say it is an approximation of the subset used):
- Grammar: `expr := or; or := and ('OR' and)*; and := not ('AND' not)*; not := 'NOT' not | cmp; cmp := primary (('=' | '<>' | '>=' | '<=' | '>' | '<') primary)?; primary := number | 'string' | "string" | true | false | call | ident ('.' ident)* | '(' expr ')'; call := ident '(' (expr (',' expr)*)? ')'`. Keywords case-insensitive.
- Field missing -> `UNDEFINED`. JSON `null` -> `null`.
- `AND`/`OR`: both operands Boolean -> Boolean; a "true"/"false" string (case-insensitive) converts to Boolean; anything else (including UNDEFINED) -> UNDEFINED. **No short-circuit**: `false AND UNDEFINED` is UNDEFINED.
- `NOT`: Boolean -> negation; "true"/"false" string converts; else UNDEFINED.
- `=`: UNDEFINED on either side -> UNDEFINED; both numbers -> numeric equality; both strings -> equality; both booleans -> equality; arrays/objects -> deep equality; mismatched types -> `false`. `<>`: UNDEFINED -> UNDEFINED; `null <> null` -> false; mismatched types -> `true`; else negated equality.
- `>`, `>=`, `<`, `<=`: numbers compare; strings that parse fully as decimals (`/^-?\d+(\.\d+)?$/`) convert; anything else or UNDEFINED -> UNDEFINED.
- `topic(n)`: n-th `/`-separated segment of `ctx.topic` (1-based), UNDEFINED if out of range; `topic()` -> the whole topic.
- `time_to_epoch(s, pattern)`: only `TS_PATTERN` is supported (throw `Error('unsupported pattern')` otherwise); `s` must match `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}(:?\d{2})?)$/` and `Date.parse` must be finite, else the call *fails*.
- `get_or_default(e, d)`: if evaluating `e` fails (throws) or yields UNDEFINED or `null`, return `d` (UNDEFINED if `d` omitted); else `e`.
- Unknown functions throw `Error('unsupported function: name')`.

- [ ] **Step 1: Failing tests** - `iot-sql.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { evaluateExpression, evaluateWhere, UNDEFINED } from '../src/index.js';
const ctx = { topic: 'fleet/veh-0042/telemetry' };
const ev = (e: string, p: unknown = {}) => evaluateExpression(e, p, ctx);

describe('IoT SQL subset', () => {
  test('missing field compares to Undefined', () => { expect(ev('lat >= -90')).toBe(UNDEFINED); });
  test('AND does not short-circuit Undefined', () => { expect(ev('false AND lat >= 0')).toBe(UNDEFINED); });
  test('mismatched = is false, mismatched <> is true', () => {
    expect(ev("v = 1", { v: '1' })).toBe(false);
    expect(ev("v <> 1", { v: '1' })).toBe(true);
  });
  test('numeric strings convert for ordering', () => { expect(ev('lat >= 10', { lat: '48.1' })).toBe(true); });
  test('non-numeric strings make ordering Undefined', () => { expect(ev('lat >= 10', { lat: 'abc' })).toBe(UNDEFINED); });
  test('topic(n)', () => { expect(ev('topic(2)')).toBe('veh-0042'); expect(ev('topic(9)')).toBe(UNDEFINED); });
  test('time_to_epoch parses the payload format', () => {
    expect(ev(`time_to_epoch(ts, "yyyy-MM-dd'T'HH:mm:ss.SSSX")`, { ts: '2026-10-04T08:00:00.000Z' })).toBe(1791100800000);
  });
  test('get_or_default catches Undefined and failures', () => {
    expect(ev('get_or_default(lat >= 0, false)')).toBe(false);
    expect(ev(`get_or_default(time_to_epoch(ts, "yyyy-MM-dd'T'HH:mm:ss.SSSX") > 0, false)`, { ts: 'nope' })).toBe(false);
  });
  test('WHERE matches only Boolean true', () => {
    expect(evaluateWhere('lat >= 0', {}, ctx)).toBe(false);
    expect(evaluateWhere('NOT (lat >= 0)', {}, ctx)).toBe(false);
  });
});
```
(`1791100800000` was checked with `Date.parse('2026-10-04T08:00:00.000Z')` on 2026-10-04.)

`rules.property.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { classifyTelemetry, evaluateWhere, whereClause, loadFixtures, validateTelemetry,
  TELEMETRY_TO_HISTORY_SQL, INVALID_TO_QUARANTINE_SQL, POSITION_TO_LOCATION_SQL } from '../src/index.js';

const topicFor = (p: unknown) => {
  const id = (p as { vehicleId?: unknown })?.vehicleId;
  return `fleet/${typeof id === 'string' ? id : 'veh-0000'}/telemetry`;
};

describe('shared rule SQL', () => {
  test.each(loadFixtures('valid'))('valid fixture $name goes to history and location', ({ topic, payload }) => {
    expect(evaluateWhere(whereClause(TELEMETRY_TO_HISTORY_SQL), payload, { topic })).toBe(true);
    expect(evaluateWhere(whereClause(POSITION_TO_LOCATION_SQL), payload, { topic })).toBe(true);
    expect(evaluateWhere(whereClause(INVALID_TO_QUARANTINE_SQL), payload, { topic })).toBe(false);
  });
  const ruleInvalid = ['missing-lat', 'lat-out-of-range', 'lat-string', 'wrong-version', 'bad-ts', 'vehicle-mismatch'];
  test.each(loadFixtures('invalid').filter((f) => ruleInvalid.includes(f.name)))('invalid fixture $name is quarantined', ({ topic, payload }) => {
    expect(classifyTelemetry(topic, payload)).toBe('quarantine');
  });
  test('extra-field passes the coarse SQL gate (ajv catches it)', () => {
    const f = loadFixtures('invalid').find((x) => x.name === 'extra-field')!;
    expect(classifyTelemetry(f.topic, f.payload)).toBe('valid');
  });
  test('VALID and NOT VALID are exact complements for arbitrary JSON', () => {
    fc.assert(fc.property(fc.jsonValue(), (payload) => {
      const topic = topicFor(payload);
      const a = evaluateWhere(whereClause(TELEMETRY_TO_HISTORY_SQL), payload, { topic });
      const b = evaluateWhere(whereClause(INVALID_TO_QUARANTINE_SQL), payload, { topic });
      expect(a !== b).toBe(true);
    }), { numRuns: 2000 });
  });
  test('every schema-valid telemetry is SQL-valid', () => {
    const arb = fc.record({
      v: fc.constant(1 as const), vehicleId: fc.integer({ min: 0, max: 9999 }).map((n) => `veh-${String(n).padStart(4, '0')}`),
      seq: fc.nat(), ts: fc.integer({ min: 1, max: 4102444800000 }).map((ms) => new Date(ms).toISOString()),
      lat: fc.double({ min: -90, max: 90, noNaN: true }), lon: fc.double({ min: -180, max: 180, noNaN: true }),
      speedKph: fc.double({ min: 0, max: 300, noNaN: true }), headingDeg: fc.double({ min: 0, max: 359.99, noNaN: true }),
      odometerKm: fc.double({ min: 0, max: 1e6, noNaN: true }), batteryPct: fc.double({ min: 0, max: 100, noNaN: true }), ignition: fc.boolean(),
    });
    fc.assert(fc.property(arb, (t) => {
      expect(validateTelemetry(t).ok).toBe(true);
      expect(classifyTelemetry(`fleet/${t.vehicleId}/telemetry`, t)).toBe('valid');
    }), { numRuns: 1000 });
  });
});
```
(`ts` starts at 1 ms because `time_to_epoch(ts) > 0` rejects the epoch itself. `-0` from `fc.double` is fine for both checks; if ajv or the interpreter disagrees on `-0`, fix the interpreter, not the arbitrary.)

`topics.test.ts`: `parseTelemetryTopic('fleet/veh-0001/telemetry') === 'veh-0001'`; `parseTelemetryTopic('fleet/veh-0001/status') === null`; `parseTelemetryTopic('fleet//telemetry') === null`; round trip with `telemetryTopic`.

- [ ] **Step 2:** `pnpm --filter @iot-telemetry/schema test` -> FAIL (exports missing).
- [ ] **Step 3: Implement** tokenizer + recursive-descent parser + evaluator per the semantics list; `whereClause` splits on the first ` WHERE ` outside quotes; `classifyTelemetry` = `evaluateWhere(VALID_TELEMETRY_PREDICATE, payload, { topic }) ? 'valid' : 'quarantine'`.
- [ ] **Step 4:** `pnpm --filter @iot-telemetry/schema test` -> all pass (property tests 2000 and 1000 runs); `pnpm lint` and `pnpm typecheck` exit 0.
- [ ] **Step 5: Commit** `feat(schema): shared IoT rule SQL with a WHERE-subset interpreter`

---

### Task 4: alert-core - types and `step()`

**Files:**
- Create: `packages/alert-core/src/types.ts`, `packages/alert-core/src/step.ts`; replace `src/index.ts`; delete `test/smoke.test.ts`
- Test: `packages/alert-core/test/step.test.ts`

**Interfaces (Produces, used by Tasks 5, 10-14, 22):**
```ts
// types.ts
export type PairStatus = 'OUTSIDE' | 'PENDING_IN' | 'INSIDE' | 'PENDING_OUT';
export interface PairState {
  readonly status: PairStatus;
  readonly since: number | null;
  readonly lastEventTs: number | null;
  readonly idsAtLastTs: readonly string[];
}
export interface GeofenceEvent { kind: 'ENTER' | 'EXIT'; eventId: string; vehicleId: string; geofenceId: string; deviceTs: number }
export interface TickEvent { kind: 'TICK'; vehicleId: string; geofenceId: string; deviceTs: number }
export type CoreEvent = GeofenceEvent | TickEvent;
export interface AlertConfig { dwellMs: number; minExitMs: number }
export type AlertType = 'ENTERED' | 'EXITED';
export interface Alert { alertId: string; type: AlertType; vehicleId: string; geofenceId: string; confirmedAt: number; triggerEventId: string | null }
export type StepOutcome = 'applied' | 'redundant' | 'duplicate' | 'late_ignored' | 'tick';
export interface StepResult { state: PairState; emitted: Alert[]; outcome: StepOutcome }
export const DEFAULT_CONFIG: AlertConfig = { dwellMs: 60_000, minExitMs: 30_000 };
export const initialState: PairState = Object.freeze({ status: 'OUTSIDE', since: null, lastEventTs: null, idsAtLastTs: Object.freeze([]) as readonly string[] });
export const isPending = (s: PairState): boolean => s.status === 'PENDING_IN' || s.status === 'PENDING_OUT';
```

- [ ] **Step 1: Failing tests** `test/step.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { step, initialState, type CoreEvent, type PairState } from '../src/index.js';

const cfg = { dwellMs: 60_000, minExitMs: 30_000 };
const enter = (id: string, s: number): CoreEvent => ({ kind: 'ENTER', eventId: id, vehicleId: 'v1', geofenceId: 'g1', deviceTs: s * 1000 });
const exit = (id: string, s: number): CoreEvent => ({ kind: 'EXIT', eventId: id, vehicleId: 'v1', geofenceId: 'g1', deviceTs: s * 1000 });
const tick = (s: number): CoreEvent => ({ kind: 'TICK', vehicleId: 'v1', geofenceId: 'g1', deviceTs: s * 1000 });
const play = (events: CoreEvent[], start: PairState = initialState) => {
  let state = start; const alerts = []; const outcomes = [];
  for (const e of events) { const r = step(state, e, cfg); state = r.state; alerts.push(...r.emitted); outcomes.push(r.outcome); }
  return { state, alerts, outcomes };
};

describe('step', () => {
  test('ENTER starts a pending entry without an alert', () => {
    const r = play([enter('a', 0)]);
    expect(r.state.status).toBe('PENDING_IN'); expect(r.alerts).toEqual([]);
  });
  test('TICK after dwell confirms ENTERED at since + dwell', () => {
    const r = play([enter('a', 10), tick(75)]);
    expect(r.state.status).toBe('INSIDE');
    expect(r.alerts).toEqual([{ alertId: 'v1:g1:ENTERED:70000', type: 'ENTERED', vehicleId: 'v1', geofenceId: 'g1', confirmedAt: 70_000, triggerEventId: null }]);
  });
  test('TICK exactly at the threshold confirms (>=)', () => { expect(play([enter('a', 0), tick(60)]).alerts).toHaveLength(1); });
  test('TICK before dwell does nothing', () => { expect(play([enter('a', 0), tick(59)]).state.status).toBe('PENDING_IN'); });
  test('EXIT before dwell cancels the entry (loiter)', () => {
    const r = play([enter('a', 0), exit('b', 5), enter('c', 10), exit('d', 15), tick(200)]);
    expect(r.alerts).toEqual([]); expect(r.state.status).toBe('OUTSIDE');
  });
  test('an event after the dwell confirms first, then applies', () => {
    const r = play([enter('a', 0), exit('b', 100)]);
    expect(r.alerts.map((a) => a.type)).toEqual(['ENTERED']);
    expect(r.alerts[0]!.triggerEventId).toBe('b');
    expect(r.state.status).toBe('PENDING_OUT');
  });
  test('short exit is absorbed (hysteresis)', () => {
    const r = play([enter('a', 0), tick(61), exit('b', 100), enter('c', 120), tick(400)]);
    expect(r.alerts.map((a) => a.type)).toEqual(['ENTERED']); expect(r.state.status).toBe('INSIDE');
  });
  test('exit confirmed after minExit', () => {
    const r = play([enter('a', 0), tick(61), exit('b', 100), tick(130)]);
    expect(r.alerts.map((a) => [a.type, a.confirmedAt])).toEqual([['ENTERED', 60_000], ['EXITED', 130_000]]);
    expect(r.state.status).toBe('OUTSIDE');
  });
  test('immediate redelivery is a duplicate', () => {
    expect(play([enter('a', 0), enter('a', 0)]).outcomes).toEqual(['applied', 'duplicate']);
  });
  test('redelivery at the same timestamp after another event is a duplicate', () => {
    const r = play([enter('a', 0), exit('b', 0), enter('a', 0)]);
    expect(r.outcomes).toEqual(['applied', 'applied', 'duplicate']); expect(r.state.status).toBe('OUTSIDE');
  });
  test('older event is late and changes nothing', () => {
    const before = play([enter('a', 50)]).state;
    const r = step(before, exit('old', 10), cfg);
    expect(r.outcome).toBe('late_ignored'); expect(r.state).toBe(before); expect(r.emitted).toEqual([]);
  });
  test('ENTER while pending or inside is redundant', () => {
    expect(play([enter('a', 0), enter('b', 5)]).outcomes).toEqual(['applied', 'redundant']);
  });
  test('TICK does not advance lastEventTs', () => {
    const r = play([enter('a', 0), tick(500)]);
    expect(r.state.lastEventTs).toBe(0);
    expect(step(r.state, exit('b', 100), cfg).outcome).toBe('applied');
  });
  test('since is clamped so a late-ordered EXIT cannot precede the confirmation', () => {
    const r = play([enter('a', 0), tick(500), exit('b', 100), tick(1000)]);
    expect(r.alerts.map((a) => [a.type, a.confirmedAt])).toEqual([['ENTERED', 60_000], ['EXITED', 130_000]]);
    const r2 = play([enter('a', 0), tick(90), exit('b', 70), tick(1000)]);
    expect(r2.alerts.map((a) => [a.type, a.confirmedAt])).toEqual([['ENTERED', 60_000], ['EXITED', 100_000]]);
  });
  test('zero thresholds confirm immediately', () => {
    const r = [enter('a', 0)].map((e) => step(initialState, e, { dwellMs: 0, minExitMs: 0 }))[0]!;
    expect(r.state.status).toBe('INSIDE'); expect(r.emitted).toHaveLength(1);
  });
  test('inputs are not mutated', () => {
    const s = Object.freeze({ ...initialState });
    expect(() => step(s, enter('a', 0), cfg)).not.toThrow();
  });
});
```
Check the clamp case by hand before trusting the test: in `r2`, ENTER@0, TICK@90 confirms ENTERED@60 and sets `since=60`; EXIT@70 sets `since=max(70,60)=70`; TICK@1000 confirms EXITED@100.

- [ ] **Step 2:** `pnpm --filter @iot-telemetry/alert-core test` -> FAIL (`step` not exported).
- [ ] **Step 3: Implement** `src/step.ts` (this logic passed a 3 000-timeline comparison against the reference model in a prototype):
```ts
import type { Alert, AlertConfig, AlertType, CoreEvent, PairState, StepOutcome, StepResult } from './types.js';

function makeAlert(type: AlertType, confirmedAt: number, ev: CoreEvent): Alert {
  return {
    alertId: `${ev.vehicleId}:${ev.geofenceId}:${type}:${confirmedAt}`,
    type, vehicleId: ev.vehicleId, geofenceId: ev.geofenceId, confirmedAt,
    triggerEventId: ev.kind === 'TICK' ? null : ev.eventId,
  };
}

function confirm(s: PairState, at: number, cfg: AlertConfig, ev: CoreEvent): { s: PairState; alert: Alert | null } {
  if (s.since === null) return { s, alert: null };
  if (s.status === 'PENDING_IN' && at - s.since >= cfg.dwellMs) {
    const confirmedAt = s.since + cfg.dwellMs;
    return { s: { ...s, status: 'INSIDE', since: confirmedAt }, alert: makeAlert('ENTERED', confirmedAt, ev) };
  }
  if (s.status === 'PENDING_OUT' && at - s.since >= cfg.minExitMs) {
    const confirmedAt = s.since + cfg.minExitMs;
    return { s: { ...s, status: 'OUTSIDE', since: confirmedAt }, alert: makeAlert('EXITED', confirmedAt, ev) };
  }
  return { s, alert: null };
}

export function step(state: PairState, ev: CoreEvent, cfg: AlertConfig): StepResult {
  if (state.lastEventTs !== null && ev.deviceTs < state.lastEventTs) return { state, emitted: [], outcome: 'late_ignored' };
  if (ev.kind !== 'TICK' && ev.deviceTs === state.lastEventTs && state.idsAtLastTs.includes(ev.eventId)) {
    return { state, emitted: [], outcome: 'duplicate' };
  }
  const emitted: Alert[] = [];
  let { s, alert } = confirm(state, ev.deviceTs, cfg, ev);
  if (alert) emitted.push(alert);
  if (ev.kind === 'TICK') return { state: s, emitted, outcome: 'tick' };

  const since = Math.max(ev.deviceTs, s.since ?? ev.deviceTs);
  let outcome: StepOutcome = 'applied';
  if (ev.kind === 'ENTER') {
    if (s.status === 'OUTSIDE') s = { ...s, status: 'PENDING_IN', since };
    else if (s.status === 'PENDING_OUT') s = { ...s, status: 'INSIDE', since };
    else outcome = 'redundant';
  } else {
    if (s.status === 'INSIDE') s = { ...s, status: 'PENDING_OUT', since };
    else if (s.status === 'PENDING_IN') s = { ...s, status: 'OUTSIDE', since };
    else outcome = 'redundant';
  }
  const idsAtLastTs = ev.deviceTs === s.lastEventTs ? [...s.idsAtLastTs, ev.eventId] : [ev.eventId];
  s = { ...s, lastEventTs: ev.deviceTs, idsAtLastTs };
  ({ s, alert } = confirm(s, ev.deviceTs, cfg, ev));
  if (alert) emitted.push(alert);
  return { state: s, emitted, outcome };
}
```
`src/index.ts` re-exports `./types.js` and `./step.js`.
- [ ] **Step 4:** `pnpm --filter @iot-telemetry/alert-core test` -> all pass; `pnpm lint` exit 0.
- [ ] **Step 5: Commit** `feat(alert-core): debounced geofence state machine with dedupe and late handling`

---

### Task 5: alert-core - `run()`, reference model, property tests, purity, publishable build

**Files:**
- Create: `packages/alert-core/src/run.ts`, `packages/alert-core/src/reference.ts`, `packages/alert-core/README.md`, `packages/alert-core/LICENSE` (MIT, "Copyright (c) 2026 Sathwik Bairaboina")
- Test: `test/run.test.ts`, `test/reference.test.ts`, `test/arbitraries.ts`, `test/dedupe.property.test.ts`, `test/ordering.property.test.ts`, `test/determinism.test.ts`, `test/purity.test.ts`

**Interfaces (Produces):**
```ts
// run.ts
export interface RunResult { state: PairState; alerts: Alert[]; counts: Record<StepOutcome, number> }
export function run(events: readonly CoreEvent[], config: AlertConfig, initial?: PairState): RunResult;
// reference.ts - written as segments on purpose, NOT by calling step()
export interface ReferenceAlert { type: AlertType; confirmedAt: number }
export function referenceAlerts(events: readonly GeofenceEvent[], horizon: number, config: AlertConfig): ReferenceAlert[];
```
`referenceAlerts`: keep the first occurrence of each `eventId`; stable-sort by `deviceTs` (ties keep delivery order); walk events building raw segments `{ inside, start, end }` (a change happens only when the kind differs from the current raw state; the initial raw state is outside from `-Infinity`); close the last segment at `horizon`; then walk segments with `confirmed = false`: an inside segment with `end - start >= dwellMs` while not confirmed emits ENTERED at `start + dwellMs`; an outside segment with `end - start >= minExitMs` while confirmed emits EXITED at `start + minExitMs`.

- [ ] **Step 1: Failing tests**

`test/arbitraries.ts`:
```ts
import fc from 'fast-check';
import type { GeofenceEvent } from '../src/index.js';
export const timelineArb = fc.array(
  fc.record({ kind: fc.constantFrom<'ENTER' | 'EXIT'>('ENTER', 'EXIT'), gapS: fc.integer({ min: 0, max: 120 }) }),
  { minLength: 1, maxLength: 25 },
).map((steps) => {
  let ts = 0;
  return steps.map((s, i): GeofenceEvent => { ts += s.gapS * 1000; return { kind: s.kind, eventId: `e${i}`, vehicleId: 'v', geofenceId: 'g', deviceTs: ts }; });
});
/** Re-deliver copies of events at positions after their original. */
export const withDuplicatesArb = timelineArb.chain((events) =>
  fc.array(fc.record({ src: fc.nat(), extra: fc.nat() }), { maxLength: 20 }).map((dups) => {
    const out = [...events];
    for (const d of dups) {
      const srcIdx = d.src % out.length;
      const pos = srcIdx + 1 + (d.extra % (out.length - srcIdx));
      out.splice(pos, 0, out[srcIdx]!);
    }
    return { events, delivered: out };
  }));
```
`test/dedupe.property.test.ts`:
```ts
import { expect, test } from 'vitest';
import fc from 'fast-check';
import { run, referenceAlerts } from '../src/index.js';
import { withDuplicatesArb } from './arbitraries.js';
const cfg = { dwellMs: 60_000, minExitMs: 30_000 };

test('sorted delivery with any redeliveries matches the reference model', () => {
  fc.assert(fc.property(withDuplicatesArb, fc.integer({ min: 0, max: 300 }), ({ events, delivered }, tailS) => {
    const horizon = events.at(-1)!.deviceTs + tailS * 1000;
    const r = run([...delivered, { kind: 'TICK', vehicleId: 'v', geofenceId: 'g', deviceTs: horizon }], cfg);
    expect(r.alerts.map((a) => ({ type: a.type, confirmedAt: a.confirmedAt }))).toEqual(referenceAlerts(events, horizon, cfg));
    expect(new Set(r.alerts.map((a) => a.alertId)).size).toBe(r.alerts.length);
  }), { numRuns: 3000 });
});
```
`test/ordering.property.test.ts` (safety under arbitrary order):
```ts
import { expect, test } from 'vitest';
import fc from 'fast-check';
import { run, step, type Alert, type CoreEvent } from '../src/index.js';
import { timelineArb } from './arbitraries.js';
const cfg = { dwellMs: 60_000, minExitMs: 30_000 };
const safe = (alerts: Alert[]) => {
  alerts.forEach((a, i) => {
    expect(a.type).toBe(i % 2 === 0 ? 'ENTERED' : 'EXITED');
    if (i > 0) expect(a.confirmedAt).toBeGreaterThanOrEqual(alerts[i - 1]!.confirmedAt);
  });
  expect(new Set(alerts.map((a) => a.alertId)).size).toBe(alerts.length);
};

test('any permutation keeps alerts alternating, monotonic and unique', () => {
  fc.assert(fc.property(timelineArb.chain((ev) => fc.shuffledSubarray(ev, { minLength: ev.length, maxLength: ev.length })), (shuffled) => {
    safe(run(shuffled, cfg).alerts);
  }), { numRuns: 3000 });
});
test('ticks at arbitrary times keep confirmedAt monotonic', () => {
  const arb = timelineArb.chain((ev) => fc.tuple(
    fc.shuffledSubarray(ev, { minLength: ev.length, maxLength: ev.length }),
    fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 2400 })), { maxLength: 15 }),
  ).map(([shuffled, ticks]) => {
    const out: CoreEvent[] = [...shuffled];
    for (const [at, s] of ticks) out.splice(at % (out.length + 1), 0, { kind: 'TICK', vehicleId: 'v', geofenceId: 'g', deviceTs: s * 1000 });
    return out;
  }));
  fc.assert(fc.property(arb, (events) => { safe(run(events, cfg).alerts); }), { numRuns: 3000 });
});
test('a late event never changes state', () => {
  fc.assert(fc.property(timelineArb, fc.nat(), (events, k) => {
    const r = run(events, cfg);
    const late = events[k % events.length]!;
    if (r.state.lastEventTs === null || late.deviceTs >= r.state.lastEventTs) return;
    const s = step(r.state, late, cfg);
    expect(s.outcome).toBe('late_ignored'); expect(s.state).toBe(r.state);
  }), { numRuns: 2000 });
});
```
`test/reference.test.ts`: hand cases - `[]` -> `[]`; ENTER@0, horizon 59 s -> `[]`; ENTER@0, horizon 60 s -> `[ENTERED@60000]`; the loiter sequence from `step.test.ts` -> `[]`; ENTER@0, EXIT@100 s, horizon 130 s -> `[ENTERED@60000, EXITED@130000]`; duplicate ids are ignored.
`test/run.test.ts`: `run` counts outcomes (`{ applied, redundant, duplicate, late_ignored, tick }` all present, zero-filled) and equals folding `step` by hand for one sequence.
`test/determinism.test.ts`: the same 500-event deep-frozen input (`structuredClone` then recursive `Object.freeze`) run twice gives `toEqual` results; inputs unchanged.
`test/purity.test.ts`: read every file in `src/` (`node:fs`, allowed in tests) and assert none matches `/\bDate\b/`, `/Math\.random/`, `/\bperformance\b/`, `/\bprocess\b/`, `/from ['"](node:|@aws-sdk|fs|path|crypto)/`; read `package.json` and assert it has no `dependencies` key.

- [ ] **Step 2:** `pnpm --filter @iot-telemetry/alert-core test` -> FAIL (`run`, `referenceAlerts` missing).
- [ ] **Step 3: Implement** `run.ts` (fold `step`, accumulate alerts and counts) and `reference.ts` as described. Export both from `index.ts`.
- [ ] **Step 4:** `pnpm --filter @iot-telemetry/alert-core test` -> all pass. If the dedupe property fails, print the counterexample and fix `step` or `reference` against the spec's semantics; do not loosen the property.
- [ ] **Step 5: Publishable build.** `README.md` for the npm package: what it does (one paragraph), install (`npm i @iot-telemetry/alert-core`), a 15-line usage example with `step`/`run`, the semantics bullets from the spec, and "Guarantees and limits" (safety under reordering, completeness only for sorted delivery). Run:
  `pnpm --filter @iot-telemetry/alert-core build` then `pnpm --filter @iot-telemetry/alert-core pack --dry-run`
  Expected: tarball contents list only `LICENSE`, `README.md`, `package.json`, `dist/*.js`, `dist/*.d.ts` (+ maps). No `src/`, no `test/`.
- [ ] **Step 6: Commit** `feat(alert-core): reference model, property tests and publishable package`

---

### Task 6: sim - PRNG, geo math, routes, geofence data

**Files:**
- Create: `packages/sim/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}` (name `@iot-telemetry/sim`, private, `"bin": { "iot-sim": "dist/cli.js" }`, dependencies `@iot-telemetry/schema: workspace:*`, `mqtt: 5.16.0`)
- Create: `packages/sim/src/prng.ts`, `src/geo.ts`, `src/routes.ts`, `src/index.ts`
- Create: `scripts/gen-routes.ts`, `data/routes/munich.geojson` (generated), `data/geofences/depot-north.geojson`
- Test: `packages/sim/test/prng.test.ts`, `test/geo.test.ts`, `test/routes.test.ts`

**Interfaces (Produces):**
```ts
// prng.ts
export type Rng = () => number;                          // [0, 1)
export function mulberry32(seed: number): Rng;
export function gaussian(rng: Rng): number;              // Box-Muller, mean 0, sd 1
// geo.ts
export interface LatLon { lat: number; lon: number }
export function haversineM(a: LatLon, b: LatLon): number;
export function bearingDeg(a: LatLon, b: LatLon): number; // [0, 360)
export function offsetM(p: LatLon, northM: number, eastM: number): LatLon;
// routes.ts
export interface Route { id: string; points: LatLon[]; cumulativeM: number[]; lengthM: number } // closed loop
export function routeFromCoords(id: string, coords: Array<[number, number]>): Route;   // GeoJSON [lon, lat]
export function loadRoutes(geojson: unknown): Route[];   // FeatureCollection of LineString
export function positionAt(route: Route, distanceM: number): LatLon & { headingDeg: number }; // wraps modulo lengthM
```
`data/geofences/depot-north.geojson`: FeatureCollection with one Polygon feature, `properties: { "id": "depot-north", "name": "Depot North" }`, ring `[[11.560,48.150],[11.575,48.150],[11.575,48.158],[11.560,48.158],[11.560,48.150]]`.
`scripts/gen-routes.ts`: `mulberry32(42)`; 12 closed loops; each loop = 24 points on an ellipse around a centre offset up to 3 km from `(48.1374, 11.5755)`, radii 600-2000 m, each point radially perturbed +-15%; loops 0-2 have centres chosen so they pass through the depot rectangle (assert in the script with point-in-rectangle and throw if not). Writes pretty JSON with coordinates rounded to 6 decimals. Running it twice produces identical bytes.

- [ ] **Step 1: Failing tests**
  - `prng.test.ts`: `mulberry32(42)` first three values are stable (snapshot via `toMatchInlineSnapshot()` on first run - acceptable here because determinism, not the values, is the property); two generators with the same seed produce the same 1 000 values; all in `[0,1)`; `gaussian` mean of 10 000 samples within 0.05 of 0 and sd within 0.05 of 1.
  - `geo.test.ts`: `haversineM({lat:48.1374,lon:11.5755},{lat:48.1474,lon:11.5755})` within 1 m of 1112; `bearingDeg` north = 0, east ~ 90; `offsetM(p, 1000, 0)` is ~1000 m from `p` (within 1 m).
  - `routes.test.ts`: a square route of 4 points has `lengthM` equal to the sum of the 4 edges (closed); `positionAt(r, 0)` equals the first point; `positionAt(r, r.lengthM + 10)` equals `positionAt(r, 10)`; heading along the first edge equals `bearingDeg(p0, p1)`; `loadRoutes` of the committed `data/routes/munich.geojson` returns 12 routes, each longer than 2 km.
- [ ] **Step 2:** run `pnpm --filter @iot-telemetry/sim test` -> FAIL.
- [ ] **Step 3: Implement** the three modules, then `pnpm gen:routes` and commit the generated file. Run `pnpm gen:routes` a second time and `git diff --exit-code data/routes` -> no diff.
- [ ] **Step 4:** `pnpm --filter @iot-telemetry/sim test` -> pass.
- [ ] **Step 5: Commit** `feat(sim): seeded PRNG, geo math, synthetic Munich routes and depot geofence`

---

### Task 7: sim - crash-safe `seq` and vehicle model

**Files:**
- Create: `packages/sim/src/seq.ts`, `packages/sim/src/vehicle.ts`
- Test: `packages/sim/test/seq.test.ts`, `packages/sim/test/vehicle.test.ts`

**Interfaces (Produces):**
```ts
// seq.ts (ADR 0006)
export interface SeqSource { next(vehicleId: string): number }
export class MemorySeq implements SeqSource { next(vehicleId: string): number }   // 0,1,2...
export class SeqAllocator implements SeqSource {
  constructor(file: string, blockSize?: number);   // default 1000; file holds { [vehicleId]: reservedUpTo }
  next(vehicleId: string): number;                 // persists a new block (write tmp + renameSync) before handing out its first number
}
// vehicle.ts
export interface VehicleSample { lat: number; lon: number; speedKph: number; headingDeg: number; odometerKm: number; batteryPct: number; ignition: boolean }
export interface VehicleModel { readonly id: string; sample(nowMs: number): VehicleSample }
export function routeVehicle(opts: { id: string; route: Route; rng: Rng; startMs: number; startOffsetM: number; baseSpeedKph: number; jitterM?: number }): VehicleModel;
export function scriptedVehicle(opts: { id: string; startMs: number; waypoints: Array<{ atMs: number } & LatLon> }): VehicleModel; // linear interpolation, holds last point; no jitter
export function toTelemetry(id: string, seq: number, nowMs: number, s: VehicleSample): Telemetry; // ts = new Date(nowMs).toISOString(); rounds lat/lon to 6 dp, others to 1 dp
```
Vehicle model details: speed = `baseSpeedKph * (1 + 0.2 * sin(2*pi*t/300s))`, clamped to [0, 130]; distance integrates speed between samples; position from `positionAt` plus gaussian jitter of `jitterM` (default 3 m) via `offsetM`; heading from the route; odometer starts at `1000 + rng()*20000` km; battery starts at `60 + rng()*40` and drains 0.15 % per km, floor 5; ignition true. `headingDeg` must stay in `[0, 360)` after rounding (map 360.0 to 0).

- [ ] **Step 1: Failing tests**
  - `seq.test.ts` (uses `fs.mkdtempSync(os.tmpdir())`): `next` is strictly increasing per vehicle and independent across vehicles; with `blockSize 10`, a new allocator on the same file after 3 calls continues at `>= 10` (restart skips the rest of the block); "restart mid-run" loop: 5 restarts x 7 calls each -> collected values strictly increasing; the file is valid JSON after every call; a missing file starts at 0.
  - `vehicle.test.ts`: every `toTelemetry(...)` output passes `validateTelemetry` for 2 000 samples over 2 h on a generated route; odometer is non-decreasing; with `jitterM: 0`, consecutive 1 s samples at 50 km/h are 10-20 m apart; `scriptedVehicle` at midpoint time returns the midpoint and after the last waypoint holds it; same seed -> identical sample sequence.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `pnpm --filter @iot-telemetry/sim test` -> pass.
- [ ] **Step 5: Commit** `feat(sim): crash-safe seq blocks and vehicle motion model`

---

### Task 8: sim - clocks, fleet runner, `loiter` and `tunnel` scenarios

**Files:**
- Create: `packages/sim/src/clock.ts`, `packages/sim/src/scenarios.ts`, `packages/sim/src/fleet.ts`
- Test: `packages/sim/test/fleet.test.ts`, `packages/sim/test/scenarios.test.ts`

**Interfaces (Produces, used by Tasks 9, 14, 22):**
```ts
// clock.ts
export interface Clock { now(): number; sleepUntil(ms: number): Promise<void> }
export class VirtualClock implements Clock { constructor(startMs: number) }   // sleepUntil jumps time, resolves immediately
export class RealClock implements Clock {}
// fleet.ts
export interface TelemetrySink { publish(t: Telemetry): Promise<void>; setOnline(vehicleId: string, online: boolean): Promise<void> }
export type ScenarioName = 'loiter' | 'tunnel';
export interface FleetOptions {
  count: number; hz: number; durationMs: number; seed: number; routes: Route[];
  scenarios: ScenarioName[]; depot: { south: number; north: number; west: number; east: number };
  clock: Clock; sink: TelemetrySink; seq: SeqSource;
  outages?: boolean;   // default true; false runs the tunnel vehicle without its outage (control run for Task 14)
}
export interface FleetRunStats { published: number; buffered: number; flushed: number; ticks: number }
export async function runFleet(opts: FleetOptions): Promise<FleetRunStats>;
export function fleetVehicleId(i: number): string;   // veh-0001 ...
// scenarios.ts
export const LOITER_ID = 'veh-9001';
export const TUNNEL_ID = 'veh-9002';
export function loiterVehicle(startMs: number, depot: FleetOptions['depot']): VehicleModel;
export function tunnelVehicle(startMs: number, depot: FleetOptions['depot']): VehicleModel;
export const TUNNEL_OFFLINE = { fromMs: 30_000, toMs: 120_000 };   // relative to start
export function depotBounds(geofenceGeoJson: unknown): FleetOptions['depot'];  // bbox of the first polygon
```
Scenario scripts (relative times, `midLon = (west+east)/2`, `d = 0.0003` deg lat ~ 33 m):
- `loiter`: 0 s at `south - 0.0010`; 20 s at `south - d`; from 25 s to 80 s alternate every 5 s between `south + d` and `south - d` (starting inside); 85 s at `south + 0.0020` (inside), held until 205 s; 235 s at `south - 0.0100`; hold. With `dwellMs 60 s`, `minExitMs 30 s`, the expected core output is exactly one ENTERED and one EXITED.
- `tunnel`: 0 s at `south - 0.0050`; 60 s at `south + 0.0030` (enters around 37 s, during the outage); held to 150 s; 200 s at `north + 0.0050`; hold. Offline from 30 s to 120 s.

Runner rules: one loop iteration per `1000/hz` ms at `startMs + k*period`; `await clock.sleepUntil(t)`; for each vehicle in id order sample at `t`, `seq.next(id)`, build telemetry; if that vehicle is offline at `t` push to its buffer, else publish. On the first tick after an outage ends: `setOnline(id, true)`, then publish the buffer in `seq` order, then the live message. Call `setOnline(id, false)` when an outage starts and `setOnline(id, true)` for every vehicle before the first tick. Fleet vehicles: `fleetVehicleId(i)` on `routes[i % routes.length]`, `startOffsetM = rng()*lengthM`, `baseSpeedKph = 30 + rng()*30`. Scenario vehicles are added after fleet vehicles. `durationMs: 0` means run until the process is stopped (only with `RealClock`).

- [ ] **Step 1: Failing tests** (all with `VirtualClock(Date.UTC(2026, 9, 4, 8))`, a capturing sink, `MemorySeq`)
  - `fleet.test.ts`: `count 5, hz 1, durationMs 60_000` -> 300 published, 0 buffered; `seq` per vehicle is 0..59 in order; every message passes `validateTelemetry`; two runs with the same seed produce identical captured arrays; `hz 2` doubles the count.
  - `scenarios.test.ts`: `loiter` alone over 400 s: samples cross `south` at least 10 times (count sign changes of `lat - south`); then a stretch of >= 100 s inside. `tunnel` over 300 s: `buffered === 90`, `flushed === 90`; the stream of published messages for `TUNNEL_ID` has `seq` 0..299 with no gaps and no duplicates when sorted; messages published between 30 s and 120 s count 0; the first message after reconnect is `seq` 30 and its `ts` is 30 s; `setOnline` calls for `TUNNEL_ID` are `[true, false, true]`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `pnpm --filter @iot-telemetry/sim test` -> pass.
- [ ] **Step 5: Commit** `feat(sim): fleet runner with virtual clock, loiter and tunnel scenarios`

---

### Task 9: sim - MQTT sink, NDJSON record/replay, CLI

**Files:**
- Create: `packages/sim/src/mqtt-sink.ts`, `packages/sim/src/ndjson.ts`, `packages/sim/src/cli.ts`
- Test: `packages/sim/test/ndjson.test.ts`, `packages/sim/test/cli.test.ts`, `packages/sim/test/mqtt-sink.int.test.ts`

**Interfaces (Produces):**
```ts
// mqtt-sink.ts
export class MqttFleetSink implements TelemetrySink {
  constructor(opts: { url: string; qos?: 0 | 1; onPublish?: (t: Telemetry, atMs: number) => void });
  publish(t: Telemetry): Promise<void>;           // lazily connects a client per vehicle: clientId = vehicleId, reconnectPeriod 0,
                                                   // will = { topic: statusTopic(id), payload: {"state":"offline","ts":...}, qos 1, retain true }
  setOnline(vehicleId: string, online: boolean): Promise<void>; // false: client.stream.destroy() (ungraceful -> broker publishes the will)
                                                                  // true: connect and publish retained {"state":"online","ts":...}
  close(): Promise<void>;                          // publish retained offline status, endAsync every client
}
// ndjson.ts
export interface RecordedMessage { publishAtMs: number; telemetry: Telemetry }
export class NdjsonRecorderSink implements TelemetrySink { constructor(file: string, clock: Clock); close(): Promise<void> }
export function readRecording(file: string): RecordedMessage[];
export async function replay(messages: RecordedMessage[], sink: TelemetrySink, opts: { clock: Clock; speed: number }): Promise<number>;
```
`onPublish` is called with `performance.timeOrigin + performance.now()` right before `publishAsync` (the bench uses it).
CLI (`node:util` `parseArgs`), first positional is the command:
- `run --count 50 --hz 1 --duration 0 --broker mqtt://localhost:5370 --scenario loiter,tunnel --seed 42 --routes data/routes/munich.geojson --geofence data/geofences/depot-north.geojson --state var/sim` (`--duration` in seconds; RealClock; `SeqAllocator(state/seq.json)`; SIGINT/SIGTERM -> `sink.close()` then exit 0)
- `record --count 5 --duration 400 --scenario loiter --seed 42 --out var/sessions/loiter.ndjson` (VirtualClock, no broker)
- `replay --file var/sessions/loiter.ndjson --broker mqtt://localhost:5370 --speed 10`
Defaults come from env when flags are absent: `MQTT_URL`, `SIM_COUNT`, `SIM_HZ`, `SIM_SCENARIOS`, `SIM_SEED`. Export `parseCli(argv: string[]): CliCommand` for tests.

- [ ] **Step 1: Failing tests**
  - `ndjson.test.ts`: record a 2-vehicle 30 s virtual run, read it back: 60 lines, `publishAtMs` non-decreasing, telemetry equals the in-memory capture; `replay` at speed 10 with a VirtualClock publishes the same 60 messages in the same order.
  - `cli.test.ts`: `parseCli(['run','--count','3','--scenario','loiter'])` -> `{ command: 'run', count: 3, scenarios: ['loiter'], hz: 1, ... }`; unknown command throws `Unknown command`; bad scenario name throws.
  - `mqtt-sink.int.test.ts` (`describe.skipIf(!process.env.IOT_IT_MQTT_URL)`): subscriber on `fleet/#` via `IOT_IT_MQTT_WS_URL`; publish 20 telemetry for `veh-0001`; subscriber receives 20 in order; `setOnline('veh-0001', false)` -> subscriber receives a retained-capable `fleet/veh-0001/status` with `"offline"` within 3 s; `close()` resolves and the test process exits.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `pnpm --filter @iot-telemetry/sim test` -> unit pass, int skipped (`1 skipped`).
- [ ] **Step 5: Live check** (Mosquitto config arrives in Task 16; run it ad hoc now):
```powershell
New-Item -ItemType Directory -Force docker/mosquitto | Out-Null
Set-Content -Encoding ascii docker/mosquitto/mosquitto.conf "listener 1883`nprotocol mqtt`nlistener 9001`nprotocol websockets`nallow_anonymous true`npersistence false"
docker run -d --name iot-telemetry-mosquitto-dev -p 5370:1883 -p 5371:9001 -v "${PWD}/docker/mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf" eclipse-mosquitto:2.1.2-alpine
$env:IOT_IT_MQTT_URL='mqtt://localhost:5370'; $env:IOT_IT_MQTT_WS_URL='ws://localhost:5371'; pnpm --filter @iot-telemetry/sim test:int
docker rm -f iot-telemetry-mosquitto-dev
```
Expected: int test passes. Keep `docker/mosquitto/mosquitto.conf` (Task 16 uses it).
- [ ] **Step 6: Commit** `feat(sim): MQTT sink with Last Will, NDJSON record/replay and CLI`

---

### Task 10: alert-lambda - Location event mapping, repository contract, handler with retries

**Files:**
- Create: `packages/alert-lambda/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}` (name `@iot-telemetry/alert-lambda`, private; dependencies `@iot-telemetry/alert-core: workspace:*`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-sns` all `3.1146.0`; devDependencies add `@types/aws-lambda 8.10.164`, `esbuild 0.28.2`)
- Create: `src/location-event.ts`, `src/repo.ts`, `src/memory-repo.ts`, `src/handle.ts`, `src/index.ts`
- Test: `test/location-event.test.ts`, `test/handle.test.ts`, `test/concurrency.test.ts`

**Interfaces (Produces, used by Tasks 11-15, 22):**
```ts
// location-event.ts - shape copied from the AWS docs example ("Location Geofence Event")
export interface LocationGeofenceEvent {
  version: '0'; id: string; 'detail-type': 'Location Geofence Event'; source: 'aws.geo';
  account: string; time: string; region: string; resources: string[];
  detail: { EventType: 'ENTER' | 'EXIT'; GeofenceId: string; DeviceId: string; SampleTime: string;
            Position: [number, number]; Accuracy?: { Horizontal: number };
            GeofenceProperties?: Record<string, string>; PositionProperties?: Record<string, string> };
}
export function isLocationGeofenceEvent(x: unknown): x is LocationGeofenceEvent;
export function toCoreEvent(e: LocationGeofenceEvent): GeofenceEvent;   // eventId = e.id, deviceTs = Date.parse(SampleTime); throws on NaN
// repo.ts
export interface StoredState { state: PairState; version: number }        // version 0 = never written
export type CommitResult = 'ok' | 'conflict';
export interface PairRef { vehicleId: string; geofenceId: string }
export interface AlertStateRepo {
  load(vehicleId: string, geofenceId: string): Promise<StoredState>;
  commit(vehicleId: string, geofenceId: string, expectedVersion: number, next: PairState, alerts: readonly Alert[]): Promise<CommitResult>;
  listPending(): Promise<PairRef[]>;
}
export interface AlertPublisher { publish(alert: Alert): Promise<void> }
// memory-repo.ts
export class MemoryAlertStateRepo implements AlertStateRepo {
  constructor(opts?: { beforeCommit?: () => Promise<void> });
  alerts(): Alert[];                     // committed alert records, in commit order
}
export class CollectingPublisher implements AlertPublisher { readonly published: Alert[] }
// handle.ts
export interface HandleDeps { repo: AlertStateRepo; publisher: AlertPublisher; config: AlertConfig; maxAttempts?: number }
export interface HandleResult { outcome: StepOutcome; emitted: Alert[]; state: PairState; attempts: number }
export class ConcurrencyError extends Error {}
export async function handleCoreEvent(event: CoreEvent, deps: HandleDeps): Promise<HandleResult>;
```
`handleCoreEvent`: loop up to `maxAttempts` (default 5): `load` -> `step` -> if outcome is `late_ignored`/`duplicate`, or outcome is `tick` with no emits, return without committing -> `commit` -> on `'ok'` publish each emitted alert in order and return; on `'conflict'` loop. After the last conflict throw `ConcurrencyError`. `MemoryAlertStateRepo.commit` awaits `beforeCommit`, then returns `'conflict'` if the stored version differs from `expectedVersion` or any alertId already exists; otherwise stores `next` with `version + 1` and appends the alerts.

- [ ] **Step 1: Failing tests**
  - `location-event.test.ts`: the ENTER example JSON from the AWS docs (paste it verbatim into `test/fixtures/location-enter.json`, plus an EXIT copy) maps to `{ kind: 'ENTER', eventId: 'aa11aa22-33a-4a4a-aaa5-example', vehicleId: 'Device1-EXAMPLE', geofenceId: 'polygon_14', deviceTs: Date.parse('2020-11-10T23:43:37.531Z') }`; `isLocationGeofenceEvent` rejects a `Location Device Position Event` and `{}`; a bad `SampleTime` throws.
  - `handle.test.ts`: ENTER then TICK after dwell -> repo has 1 alert, publisher got 1, final `state.status === 'INSIDE'`; a duplicate redelivery does not call `commit` (spy) and publishes nothing; a repo whose `commit` returns `'conflict'` twice then `'ok'` -> `attempts === 3`; always `'conflict'` -> rejects with `ConcurrencyError` after 5 attempts and nothing is published.
  - `concurrency.test.ts`:
```ts
test('racing ticks on one pair commit and publish exactly one alert (200 rounds)', async () => {
  for (let round = 0; round < 200; round++) {
    const repo = new MemoryAlertStateRepo({ beforeCommit: () => new Promise((r) => setImmediate(r)) });
    const pub = new CollectingPublisher();
    const deps = { repo, publisher: pub, config: { dwellMs: 60_000, minExitMs: 30_000 } };
    await handleCoreEvent({ kind: 'ENTER', eventId: 'e1', vehicleId: 'v', geofenceId: 'g', deviceTs: 0 }, deps);
    const tick = { kind: 'TICK', vehicleId: 'v', geofenceId: 'g', deviceTs: 61_000 } as const;
    await Promise.all([handleCoreEvent(tick, deps), handleCoreEvent(tick, deps), handleCoreEvent(tick, deps)]);
    expect(repo.alerts()).toHaveLength(1);
    expect(pub.published).toHaveLength(1);
  }
});
```
  plus the same shape for three concurrent deliveries of one ENTER event: exactly one commit, stored state `PENDING_IN`, version 1.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `pnpm --filter @iot-telemetry/alert-lambda test` -> pass.
- [ ] **Step 5: Commit** `feat(alert-lambda): Location event mapping and optimistic-concurrency handler`

---

### Task 11: alert-lambda - DynamoDB repository and integration tests

**Files:**
- Create: `packages/alert-lambda/src/dynamo-repo.ts`
- Test: `packages/alert-lambda/test/dynamo-keys.test.ts`, `test/dynamo-repo.int.test.ts`, `test/concurrency.int.test.ts`

**Interfaces (Produces):**
```ts
export const ALERT_STATE_GSI = 'pending-index';
export function stateKey(vehicleId: string, geofenceId: string): { pk: string; sk: string };   // VEH#v / GF#g
export function alertKey(a: Alert): { pk: string; sk: string };   // VEH#v / ALERT#{confirmedAt padded to 15}#{geofenceId}#{type}
export function toItem(vehicleId: string, geofenceId: string, s: PairState, version: number): Record<string, unknown>; // adds pending: "1" only when isPending(s)
export function fromItem(item: Record<string, unknown> | undefined): StoredState;
export class DynamoAlertStateRepo implements AlertStateRepo { constructor(doc: DynamoDBDocumentClient, tableName: string) }
export async function createAlertStateTable(client: DynamoDBClient, tableName: string): Promise<void>; // idempotent (ResourceInUseException ok); PAY_PER_REQUEST; pk/sk S; GSI pending-index (pending S HASH, pk S RANGE, projection ALL)
```
`commit` uses `TransactWriteCommand` from `@aws-sdk/lib-dynamodb`: state Put with `ConditionExpression: expectedVersion === 0 ? 'attribute_not_exists(pk)' : 'version = :expected'`, and one Put per alert with `attribute_not_exists(pk)`. Map an error whose `name === 'TransactionCanceledException'` and whose `CancellationReasons` contain only `ConditionalCheckFailed`, `TransactionConflict` or `None` codes to `'conflict'`; rethrow anything else. `listPending` queries the GSI with `pending = :one` and paginates. `fromItem(undefined)` returns `{ state: initialState, version: 0 }`. A `null` `since` is stored as an absent attribute.

- [ ] **Step 1: Failing tests**
  - `dynamo-keys.test.ts` (unit): `alertKey` pads (`ALERT#000000000060000#g1#ENTERED`); `toItem`/`fromItem` round-trip for each of the 4 statuses; `pending` present only for PENDING_*.
  - `dynamo-repo.int.test.ts` (`describe.skipIf(!process.env.IOT_IT_DYNAMO_URL)`; client with `endpoint`, `region: 'us-east-1'`, credentials `{ accessKeyId: 'test', secretAccessKey: 'test' }`; table name `AlertState-${randomUUID()}`, deleted in `afterAll`): load of a missing pair -> version 0; commit v0 -> ok, load -> version 1; commit with stale version 0 -> `'conflict'`; commit that re-inserts an existing alert -> `'conflict'`; `listPending` returns a PENDING_IN pair and not an INSIDE pair.
  - `concurrency.int.test.ts`: the 200-round racing-ticks test from Task 10 against `DynamoAlertStateRepo` (one table, pair id `v-${round}`), asserting exactly one alert item per round (query `pk = VEH#v-{round}` with `begins_with(sk, 'ALERT#')`) and one publish.
- [ ] **Step 2:** FAIL. **Step 3:** implement.
- [ ] **Step 4:** unit: `pnpm --filter @iot-telemetry/alert-lambda test` -> pass, int skipped. Integration:
```powershell
docker run -d --name iot-telemetry-dynamodb-dev -p 5372:8000 amazon/dynamodb-local:3.3.1 -jar DynamoDBLocal.jar -inMemory -sharedDb
$env:IOT_IT_DYNAMO_URL='http://localhost:5372'; pnpm --filter @iot-telemetry/alert-lambda test:int
docker rm -f iot-telemetry-dynamodb-dev
```
Expected: both int files pass. Record the duration of the 200-round test in the ledger.
- [ ] **Step 5: Commit** `feat(alert-lambda): DynamoDB repository with conditional transactions`

---

### Task 12: alert-lambda - Lambda entry, sweep, SNS publisher, bundle

**Files:**
- Create: `packages/alert-lambda/src/sns-publisher.ts`, `src/lambda.ts`, `scripts/bundle.mjs`; add scripts `"bundle": "node scripts/bundle.mjs"`
- Test: `test/lambda.test.ts`, `test/bundle.test.ts`

**Interfaces (Produces, used by Task 21):**
```ts
// sns-publisher.ts
export class SnsAlertPublisher implements AlertPublisher { constructor(client: SNSClient, topicArn: string) } // PublishCommand: Message = JSON alert, MessageAttributes alertId + type (String)
// lambda.ts
export interface SweepEvent { source: 'iot-telemetry.sweep' }
export function createHandler(deps: HandleDeps, now: () => number): (event: unknown) => Promise<{ handled: number; outcomes: StepOutcome[] }>;
export const handler: (event: unknown) => Promise<{ handled: number; outcomes: StepOutcome[] }>;
// env: TABLE_NAME, TOPIC_ARN, DWELL_SECONDS (default 60), MIN_EXIT_SECONDS (default 30); clients created lazily once per container
```
`createHandler`: a Location geofence event -> `handleCoreEvent(toCoreEvent(e))`; a sweep event -> `repo.listPending()` then a TICK at `now()` for each pair, sequentially; anything else throws `Error('unsupported event')`. The bundle entry is `src/lambda.ts`; output `dist-lambda/index.mjs` (handler export name `handler`, so the CDK handler string is `index.handler`).

`scripts/bundle.mjs`:
```js
import { build } from 'esbuild';
await build({
  entryPoints: ['src/lambda.ts'], outfile: 'dist-lambda/index.mjs', bundle: true, platform: 'node', target: 'node24',
  format: 'esm', conditions: ['source'], external: ['@aws-sdk/*'], minify: false, sourcemap: false,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
```
- [ ] **Step 1: Failing tests**
  - `lambda.test.ts`: with `MemoryAlertStateRepo` + `CollectingPublisher` and `now = () => 61_000`: geofence ENTER at `SampleTime` epoch 0 -> outcome `applied`; sweep -> one TICK, one alert published; an `{ foo: 1 }` event rejects with `unsupported event`.
  - `bundle.test.ts`: runs `node scripts/bundle.mjs` via `execFileSync` (cwd = package dir), then asserts `dist-lambda/index.mjs` exists, contains `export` of `handler`, and does not contain the string `@aws-sdk/client-dynamodb/dist` (external).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `pnpm --filter @iot-telemetry/alert-lambda test` and `pnpm --filter @iot-telemetry/alert-lambda bundle` -> pass, file written.
- [ ] **Step 5: Commit** `feat(alert-lambda): Lambda entry with scheduled sweep, SNS publisher and esbuild bundle`

---

### Task 13: local-pipeline - geofence stub, router, NDJSON sinks

**Files:**
- Create: `packages/local-pipeline/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}` (name `@iot-telemetry/local-pipeline`, private; dependencies: `@iot-telemetry/schema`, `@iot-telemetry/alert-core`, `@iot-telemetry/alert-lambda` (workspace:*), `@turf/boolean-point-in-polygon 7.4.0`, `@turf/helpers 7.4.0`, `mqtt 5.16.0`, `@aws-sdk/client-dynamodb 3.1146.0`, `@aws-sdk/lib-dynamodb 3.1146.0`, `@iot-telemetry/sim: workspace:*` (runtime: `scenario-run.ts` and the PRNG))
- Create: `src/geofence-stub.ts`, `src/router.ts`, `src/sinks.ts`, `src/index.ts`
- Test: `test/geofence-stub.test.ts`, `test/router.test.ts`, `test/sinks.test.ts`

**Interfaces (Produces):**
```ts
// geofence-stub.ts
export interface Geofence { id: string; name: string; polygon: { type: 'Polygon'; coordinates: number[][][] } }
export function loadGeofences(geojson: unknown): Geofence[];   // FeatureCollection, properties.id / properties.name
export class GeofenceStub {
  constructor(geofences: Geofence[], opts?: { duplicateRate?: number; seed?: number });
  evaluate(t: Telemetry): LocationGeofenceEvent[];   // per (vehicle, geofence) remembers inside/outside; emits on change only
  readonly duplicateDeliveries: number;
}
// router.ts
export type RouteResult =
  | { kind: 'valid'; telemetry: Telemetry; schemaErrors: string[] }
  | { kind: 'quarantine'; reason: 'invalid_json' | 'rule_sql'; raw: unknown };
export function routeMessage(topic: string, payload: string | Uint8Array): RouteResult;
// sinks.ts
export interface Sink<T> { write(record: T): Promise<void> }
export interface QuarantineRecord { topic: string; receivedAt: string; reason: string; raw: unknown }
export class MemorySink<T> implements Sink<T> { readonly records: T[] }
export class NdjsonHistorySink implements Sink<Telemetry> { constructor(rootDir: string) }        // {root}/history/dt=YYYY-MM-DD/hour=HH.ndjson by telemetry ts (UTC)
export class NdjsonQuarantineSink implements Sink<QuarantineRecord> { constructor(rootDir: string) } // {root}/quarantine/dt=YYYY-MM-DD.ndjson by receivedAt
```
Stub event shape: `version '0'`, `id = loc-${vehicleId}-${geofenceId}-${seq}-${EventType}`, `'detail-type': 'Location Geofence Event'`, `source: 'aws.geo'`, `account: '000000000000'`, `region: 'local'`, `time = SampleTime = t.ts`, `resources: ['arn:aws:geo:local:000000000000:geofence-collection/fleet-geofences', 'arn:aws:geo:local:000000000000:tracker/fleet']`, `Position: [lon, lat]`, `GeofenceProperties: { name }`. A vehicle's first-ever position inside a geofence emits ENTER (Location behaves the same for a first position inside). With `duplicateRate > 0` each emitted event is followed by an identical copy with that probability (seeded `mulberry32` imported from `@iot-telemetry/sim`). Router: JSON parse failure -> `invalid_json`; `classifyTelemetry(topic, parsed) === 'quarantine'` -> `rule_sql`; else `valid` with `schemaErrors` from `validateTelemetry` (empty when valid). The router never drops a message.

- [ ] **Step 1: Failing tests**
  - `geofence-stub.test.ts`: positions outside, inside, inside, outside -> exactly `[ENTER, EXIT]` with the documented ids and `Position` order `[lon, lat]`; the output passes `isLocationGeofenceEvent`; two vehicles are tracked independently; `duplicateRate: 1` doubles every event and `duplicateDeliveries` counts them; same seed -> same duplicates.
  - `router.test.ts`: each valid fixture -> `valid` with `schemaErrors: []`; `extra-field` -> `valid` with non-empty `schemaErrors`; each rule-invalid fixture -> `quarantine`/`rule_sql`; `'{not json'` -> `invalid_json`; `Uint8Array` input works.
  - `sinks.test.ts` (tmp dir): two telemetry in different hours land in two files; lines parse back; quarantine file name uses `receivedAt` date.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `pnpm --filter @iot-telemetry/local-pipeline test` -> pass.
- [ ] **Step 5: Commit** `feat(local-pipeline): geofence stub, shared-SQL router and NDJSON sinks`

---

### Task 14: local-pipeline - pipeline core and scenario golden tests

**Files:**
- Create: `packages/local-pipeline/src/pipeline.ts`, `packages/local-pipeline/src/scenario-run.ts` (exported from `index.ts`; reused by the bench in Task 22)
- Test: `test/pipeline.test.ts`, `test/scenarios.golden.test.ts`, `test/golden/loiter.json`, `test/golden/tunnel.json`

**Interfaces (Produces, used by Tasks 15, 22):**
```ts
export interface PipelineDeps {
  repo: AlertStateRepo; publisher: AlertPublisher; config: AlertConfig; geofences: Geofence[];
  history: Sink<Telemetry>; quarantine: Sink<QuarantineRecord>; duplicateRate?: number; seed?: number;
  receivedAt?: () => string;   // default () => new Date().toISOString(); tests pass a fixed value
}
export interface PipelineStats {
  received: number; valid: number; quarantined: number; schemaViolations: number;
  geofenceEvents: number; duplicateDeliveries: number; naiveAlerts: number; alerts: number;
  outcomes: Record<StepOutcome, number>;
}
export interface Pipeline {
  handle(topic: string, payload: string | Uint8Array): Promise<void>;   // callers must await in arrival order
  latest(): ReadonlyMap<string, Telemetry>;
  stats(): PipelineStats;
}
export function createPipeline(deps: PipelineDeps): Pipeline;
// scenario-run.ts
export interface ScenarioRunResult { alerts: Alert[]; stats: PipelineStats; history: Telemetry[]; fleet: FleetRunStats }
export async function simulateScenarios(opts: { scenarios: ScenarioName[]; outages?: boolean; duplicateRate?: number; seed?: number; durationS?: number; geofenceFile?: string }): Promise<ScenarioRunResult>;
```
`handle`: route -> quarantine sink, or: history sink; update `latest` only if `seq` is greater than the stored one; geofence stub -> for each event `naiveAlerts += (EventType === 'ENTER')`, `handleCoreEvent(toCoreEvent(e))`, track pending pairs from `result.state`; then for each pending pair of this vehicle, `handleCoreEvent({ kind: 'TICK', deviceTs: Date.parse(t.ts) })` (ADR 0005). `alerts` counts published alerts.

- [ ] **Step 1: Failing tests**
  - `pipeline.test.ts`: an invalid message goes to quarantine and nowhere else; a valid one goes to history and `latest`; an older `seq` does not overwrite `latest`; a scripted in/out/in sequence produces the expected alert via TICKs from later telemetry.
  - `scenarios.golden.test.ts` uses `simulateScenarios`, which runs `runFleet` (count 0, the scenario vehicles only, `VirtualClock(Date.UTC(2026, 9, 4, 8))`, 400 s, hz 1, seed 42, `MemorySeq`) into a capturing sink, then feeds every captured message, in publish order, through `createPipeline` with `MemoryAlertStateRepo`, `CollectingPublisher`, `MemorySink`s, `DEFAULT_CONFIG`, the committed depot geofence. For the no-outage control run pass `outages: false` to `runFleet` (defined in Task 8).
    - **loiter**: published alerts for `veh-9001` are exactly `['ENTERED', 'EXITED']`; `naiveAlerts >= 6`; with `duplicateRate: 0.5` the alerts are identical and `duplicateDeliveries > 0`.
    - **tunnel**: alerts for `veh-9002` with the outage equal the alerts without the outage (`toEqual`, including `confirmedAt`); history `seq` for `veh-9002` sorted is `0..399` with no gaps.
    - Golden files: write `{ alerts, stats }` to `test/golden/<name>.json` when `UPDATE_GOLDEN=1`, else compare with `toEqual`. Generate once with `$env:UPDATE_GOLDEN='1'; pnpm --filter @iot-telemetry/local-pipeline test; Remove-Item Env:UPDATE_GOLDEN`, read the files, check them against the semantic assertions above, then commit them.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `pnpm --filter @iot-telemetry/local-pipeline test` -> pass without `UPDATE_GOLDEN`. Ledger: record loiter `naiveAlerts` vs core alerts.
- [ ] **Step 5: Commit** `feat(local-pipeline): pipeline core with loiter and tunnel golden scenarios`

---

### Task 15: local-pipeline - MQTT wiring (`main.ts`)

**Files:**
- Create: `packages/local-pipeline/src/main.ts`; script `"start": "node dist/main.js"`
- Test: `packages/local-pipeline/test/main.int.test.ts`

**Interfaces:**
```ts
export interface MainOptions { mqttUrl: string; geofenceFile: string; dataDir: string; dynamoUrl?: string; tableName?: string; duplicateRate?: number; seed?: number }
export function optionsFromEnv(env: NodeJS.ProcessEnv): MainOptions;  // MQTT_URL, GEOFENCE_FILE, DATA_DIR (default var), DYNAMO_URL, ALERT_TABLE (default AlertState), DUPLICATE_RATE (default 0.2), SEED (default 42)
export async function startPipeline(opts: MainOptions): Promise<{ stop(): Promise<void>; stats(): PipelineStats }>;
```
`startPipeline`: if `dynamoUrl` is set, create the table (`createAlertStateTable`) and use `DynamoAlertStateRepo`, else `MemoryAlertStateRepo`. Connect one MQTT client (`clientId: 'iot-telemetry-pipeline'`), publish the geofence FeatureCollection retained to `fleet/geofences` (QoS 1), subscribe `fleet/+/telemetry` QoS 1, and process messages through a promise chain so they are handled strictly in arrival order. The `AlertPublisher` publishes the alert JSON to `fleet/alerts` (QoS 1) and logs one line `ALERT <type> <vehicleId> <geofenceId> <iso confirmedAt>`. Every 10 s log one JSON stats line. When run as the entry module, start from env and stop on SIGINT/SIGTERM.

- [ ] **Step 1: Failing test** `main.int.test.ts` (`skipIf(!process.env.IOT_IT_MQTT_URL)`): start with a tmp data dir and no Dynamo; a WS subscriber receives the retained `fleet/geofences` FeatureCollection; publish the recorded `loiter` session messages (from `runFleet` + VirtualClock, published sequentially with QoS 1) to the broker; within 10 s the subscriber receives exactly one ENTERED and one EXITED on `fleet/alerts` for `veh-9001`; `stop()` resolves.
- [ ] **Step 2:** FAIL (skips without env; run it with Mosquitto as in Task 9 Step 5 to see it fail). **Step 3:** implement.
- [ ] **Step 4:** with the dev Mosquitto container running: `$env:IOT_IT_MQTT_URL='mqtt://localhost:5370'; $env:IOT_IT_MQTT_WS_URL='ws://localhost:5371'; pnpm --filter @iot-telemetry/local-pipeline test:int` -> pass. Remove the container.
- [ ] **Step 5: Commit** `feat(local-pipeline): MQTT wiring with retained geofences and live alerts`

---

### Task 16: Docker images and compose stack

**Files:**
- Create: `docker/node.Dockerfile`, `docker-compose.yml`, `.env.example` (only non-secret knobs: `SIM_COUNT=50`, `SIM_HZ=1`, `SIM_SCENARIOS=loiter,tunnel`, `DUPLICATE_RATE=0.2`)
- Modify: `docker/mosquitto/mosquitto.conf` (from Task 9)

`docker/node.Dockerfile`:
```dockerfile
FROM node:24-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm -r --filter "!@iot-telemetry/infra" run build
ENV NODE_ENV=production
```
`docker-compose.yml`:
```yaml
name: iot-telemetry
services:
  mosquitto:
    image: eclipse-mosquitto:2.1.2-alpine
    container_name: iot-telemetry-mosquitto
    ports: ["127.0.0.1:5370:1883", "127.0.0.1:5371:9001"]
    volumes: ["./docker/mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro"]
    healthcheck:
      test: ["CMD-SHELL", "mosquitto_sub -h localhost -t '$$SYS/broker/version' -C 1 -W 3 || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 10
  dynamodb:
    image: amazon/dynamodb-local:3.3.1
    container_name: iot-telemetry-dynamodb
    command: ["-jar", "DynamoDBLocal.jar", "-inMemory", "-sharedDb"]
    ports: ["127.0.0.1:5372:8000"]
    healthcheck:
      test: ["CMD-SHELL", "curl -s -o /dev/null http://localhost:8000 || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 10
  pipeline:
    build: { context: ., dockerfile: docker/node.Dockerfile }
    image: iot-telemetry-node:dev
    container_name: iot-telemetry-pipeline
    command: ["node", "packages/local-pipeline/dist/main.js"]
    environment:
      MQTT_URL: mqtt://mosquitto:1883
      GEOFENCE_FILE: data/geofences/depot-north.geojson
      DATA_DIR: /app/var
      DYNAMO_URL: http://dynamodb:8000
      AWS_ACCESS_KEY_ID: local
      AWS_SECRET_ACCESS_KEY: local
      AWS_REGION: us-east-1
      DUPLICATE_RATE: ${DUPLICATE_RATE:-0.2}
    depends_on: { mosquitto: { condition: service_healthy }, dynamodb: { condition: service_healthy } }
  sim:
    image: iot-telemetry-node:dev
    container_name: iot-telemetry-sim
    command: ["node", "packages/sim/dist/cli.js", "run"]
    environment:
      MQTT_URL: mqtt://mosquitto:1883
      SIM_COUNT: ${SIM_COUNT:-50}
      SIM_HZ: ${SIM_HZ:-1}
      SIM_SCENARIOS: ${SIM_SCENARIOS:-loiter,tunnel}
    depends_on: { pipeline: { condition: service_started } }
  web:
    image: iot-telemetry-node:dev
    container_name: iot-telemetry-web
    working_dir: /app/packages/web
    command: ["pnpm", "exec", "vite", "preview", "--host", "0.0.0.0", "--port", "5373", "--strictPort"]
    ports: ["127.0.0.1:5373:5373"]
    depends_on: { mosquitto: { condition: service_healthy } }
  bench:
    image: iot-telemetry-node:dev
    container_name: iot-telemetry-bench
    profiles: ["bench"]
    command: ["node", "bench/dist/run.js"]
    environment: { MQTT_URL: "mqtt://mosquitto:1883", MQTT_WS_URL: "ws://mosquitto:9001" }
    volumes: ["./bench/results:/app/bench/results"]
    depends_on: { mosquitto: { condition: service_healthy } }
```
(The `web` and `bench` services work once Tasks 18 and 22 exist; until then `docker compose up` brings up mosquitto, dynamodb, pipeline, sim.) The image name `iot-telemetry-node:dev` is shared by pipeline/sim/web/bench and built once by `pipeline`. If the healthcheck binaries differ in these images (no `curl` in dynamodb-local), replace with a check that works and record a Ruling.

- [ ] **Step 1:** `docker compose config --quiet` -> exit 0.
- [ ] **Step 2:** `docker compose build pipeline` -> succeeds (if pnpm cannot install a platform binary for linux from the Windows lockfile, add the missing platform via `pnpm.supportedArchitectures` in root `package.json` (`os: ["win32","linux"], cpu: ["x64","arm64"]`, `libc: ["glibc","musl"]`), re-run `pnpm install`, and record a Ruling).
- [ ] **Step 3:** `docker compose up -d mosquitto dynamodb pipeline sim`; wait 150 s; `docker compose logs pipeline | Select-String ALERT` -> at least one `ALERT ENTERED veh-9001 depot-north` line; `docker compose ps` shows all four running with names `iot-telemetry-*`.
- [ ] **Step 4:** `docker compose down`.
- [ ] **Step 5: Commit** `build: docker image and compose stack on ports 5370-5373`

---

### Task 17: web - state reducer and MQTT feed

> Before any UI work load the frontend skills (`design-taste-frontend`, per the user's global rules).

**Files:**
- Create: `packages/web/{package.json,tsconfig.json,vite.config.ts,index.html}` (name `@iot-telemetry/web`, private; dependencies `react 19.3.0`, `react-dom 19.3.0`, `maplibre-gl 6.12.0`, `mqtt 5.16.0`, `@iot-telemetry/schema: workspace:*`, `@iot-telemetry/alert-core: workspace:*`; devDependencies `vite 8.3.2`, `@vitejs/plugin-react 6.1.1`, `@types/react 19.3.0`, `@types/react-dom 19.3.0`, `typescript`, `vitest`, `@types/node`, `@playwright/test 1.63.0`; scripts `dev` (`vite --port 5373 --strictPort`), `build` (`tsc -p tsconfig.json --noEmit && vite build`), `preview`, `typecheck`, `test` (`vitest run test`), `test:int` (`vitest run .int.test --passWithNoTests`), `e2e` (`playwright test`))
- `tsconfig.json`: extends base with `"lib": ["ES2023", "DOM", "DOM.Iterable"]`, `"jsx": "react-jsx"`, `"types": ["vite/client"]`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, include `src`, `test`.
- `vite.config.ts`: `plugins: [react()]`, `resolve.conditions: ['source', 'browser', 'module', 'import', 'default']`, `ssr.resolve.conditions: ['source']`, `preview: { port: 5373, strictPort: true }`, `test: { include: ['test/**/*.test.ts'] }`.
- Create: `src/state.ts`, `src/feed.ts`
- Test: `test/state.test.ts`

**Interfaces (Produces):**
```ts
// state.ts
export interface VehicleView { telemetry: Telemetry; trail: Array<[number, number]>; online: boolean; lastSeenMs: number }
export interface FleetState {
  vehicles: Record<string, VehicleView>; alerts: Alert[]; geofences: GeoJSON.FeatureCollection | null;
  messages: number; selected: string | null;
}
export type FleetAction =
  | { type: 'telemetry'; telemetry: Telemetry; receivedMs: number }
  | { type: 'status'; vehicleId: string; online: boolean }
  | { type: 'alert'; alert: Alert }
  | { type: 'geofences'; geojson: GeoJSON.FeatureCollection }
  | { type: 'select'; vehicleId: string | null };
export const initialFleetState: FleetState;
export function fleetReducer(state: FleetState, action: FleetAction): FleetState;
export const TRAIL_POINTS = 120;
export const MAX_ALERTS = 50;
// feed.ts
export function mqttUrlFromLocation(search: string, fallback: string): string;   // ?mqtt=ws://... overrides
export function connectFeed(url: string, dispatch: (a: FleetAction) => void): () => void;  // subscribes fleet/+/telemetry, fleet/+/status, fleet/alerts, fleet/geofences
```
Reducer rules: telemetry with `seq` lower than the stored one does not move the marker (tunnel replay) but still counts in `messages`; trail appends `[lon, lat]`, capped at `TRAIL_POINTS`; alerts dedupe by `alertId`, newest first, capped at `MAX_ALERTS`; unknown vehicle on `status` is ignored. `connectFeed` uses `import { connect } from 'mqtt'` (resolves to `dist/mqtt.esm.js` via the browser condition), parses JSON defensively (bad JSON is ignored), and returns a disposer that calls `client.end()`. Default URL: `import.meta.env.VITE_MQTT_URL ?? 'ws://localhost:5371'`.

- [ ] **Step 1: Failing tests** `test/state.test.ts`: telemetry adds a vehicle; older seq keeps position but increments `messages`; trail cap at 120; alert dedupe by id and ordering newest-first; cap 50; `select`; `mqttUrlFromLocation('?mqtt=ws%3A%2F%2Fmosquitto%3A9001', 'ws://localhost:5371') === 'ws://mosquitto:9001'`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `pnpm --filter @iot-telemetry/web test` -> pass.
- [ ] **Step 5: Commit** `feat(web): fleet state reducer and MQTT-over-WebSockets feed`

---

### Task 18: web - live map UI

**Files:**
- Create: `packages/web/src/main.tsx`, `src/App.tsx`, `src/FleetMap.tsx`, `src/AlertTimeline.tsx`, `src/styles.css`

Requirements (design per the loaded taste skill; keep it a calm operations console, dark-first with a light theme via `prefers-color-scheme`):
- Full-height MapLibre map centred on `[11.5755, 48.1374]`, zoom 12. Style: a raster source from `import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'` with attribution `© OpenStreetMap contributors`.
- GeoJSON sources/layers: `geofences` (fill + outline), `vehicles` (circle layer; colour by `speedKph`; offline vehicles greyed), `trail` (line for the selected vehicle). Update sources with `setData` from state; never re-create the map on renders.
- Side panel: vehicle count, online count, messages/s (rolling 5 s), last alert, and `AlertTimeline` (type chip ENTERED/EXITED, vehicle, geofence, `confirmedAt` as local time). Clicking a marker selects the vehicle; `Esc` clears.
- Connection badge: `connecting`, `live`, `offline` from mqtt client events. `data-testid` attributes: `vehicle-count`, `alert-row`, `conn-status`.
- Phone width: panel becomes a bottom sheet under 720 px.
- [ ] **Step 1:** `pnpm --filter @iot-telemetry/web build` -> `dist/` written, no type errors.
- [ ] **Step 2: Manual check:** compose `up -d mosquitto pipeline sim` (Task 16), `pnpm --filter @iot-telemetry/web dev`, open `http://localhost:5373`: markers move, depot polygon visible, an ENTERED row appears within ~3 minutes. `docker compose down`. Note the result in the ledger.
- [ ] **Step 3: Commit** `feat(web): live MapLibre fleet map with geofences and alert timeline`

---

### Task 19: web - Playwright end-to-end in Docker + screenshot

**Files:**
- Create: `docker/e2e.Dockerfile`, `packages/web/playwright.config.ts`, `packages/web/e2e/map.spec.ts`
- Modify: `docker-compose.yml` (add `e2e` service, profile `e2e`)
- Create (generated): `docs/media/map.png`

`docker/e2e.Dockerfile`:
```dockerfile
FROM mcr.microsoft.com/playwright:v1.63.0-noble
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
```
Compose service:
```yaml
  e2e:
    build: { context: ., dockerfile: docker/e2e.Dockerfile }
    container_name: iot-telemetry-e2e
    profiles: ["e2e"]
    working_dir: /app/packages/web
    command: ["pnpm", "exec", "playwright", "test"]
    environment: { E2E_BASE_URL: "http://web:5373", E2E_MQTT_URL: "ws://mosquitto:9001" }
    volumes: ["./docs/media:/app/docs/media"]
    depends_on: { web: { condition: service_started }, sim: { condition: service_started } }
```
`map.spec.ts`: open `${E2E_BASE_URL}/?mqtt=${encodeURIComponent(E2E_MQTT_URL)}`; expect `conn-status` to have text `live` within 15 s; expect `vehicle-count` to be > 0 within 15 s; wait up to 180 s for at least one `alert-row`; take `page.screenshot({ path: '/app/docs/media/map.png' })` at viewport 1280x800. Tiles may fail without internet inside the container; the test must not depend on tiles.
- [ ] **Step 1:** `docker compose --profile e2e up -d mosquitto dynamodb pipeline sim web`, then `docker compose --profile e2e run --rm e2e` -> `1 passed`; `docs/media/map.png` exists. `docker compose --profile e2e down`.
- [ ] **Step 2:** Look at the screenshot (Read tool). If it shows a broken layout, fix the UI and repeat.
- [ ] **Step 3: Commit** `test(web): Playwright end-to-end in Docker with README screenshot`

---

### Task 20: infra - `FleetTopicRule` construct and device policy

**Files:**
- Create: `infra/{package.json,tsconfig.json,vitest.config.ts,cdk.json}` (name `@iot-telemetry/infra`, private; dependencies `aws-cdk-lib 2.272.0`, `constructs 10.8.1`, `cdk-nag 3.0.2`, `@iot-telemetry/schema: workspace:*`; devDependencies `aws-cdk 2.1144.0`, `tsx`, `typescript`, `vitest`, `vite`, `@types/node`; scripts `typecheck`, `test` (`vitest run`), `test:int` (`vitest run .int.test --passWithNoTests`), `synth` (`pnpm --filter @iot-telemetry/alert-lambda run bundle && cdk synth --quiet --no-notices`), `build` (`tsc -p tsconfig.json --noEmit`))
- `cdk.json`: `{ "app": "npx tsx --conditions=source bin/app.ts", "context": {} }`
- Create: `infra/lib/fleet-topic-rule.ts`, `infra/lib/device-policy.ts`
- Test: `infra/test/fleet-topic-rule.test.ts`, `infra/test/device-policy.test.ts`

**Interfaces (Produces):**
```ts
// fleet-topic-rule.ts
export interface FleetTopicRuleProps {
  ruleName: string; sql: string; actions: iot.CfnTopicRule.ActionProperty[];
  errorAction: iot.CfnTopicRule.ActionProperty;     // required by type
  description?: string;
}
export class FleetTopicRule extends Construct {
  readonly rule: iot.CfnTopicRule;
  readonly failureAlarm: cloudwatch.Alarm;          // AWS/IoT Failure, dimension RuleName, Sum >= 1 over 5 min
  constructor(scope: Construct, id: string, props: FleetTopicRuleProps); // throws if errorAction is missing at runtime or actions is empty; awsIotSqlVersion '2016-03-23'
}
// device-policy.ts
export function devicePolicyDocument(stack: Stack): Record<string, unknown>;
export class DevicePolicy extends Construct { readonly policy: iot.CfnPolicy }   // policyName 'fleet-device-policy'
```
Policy statements (use `Stack.of(this).formatArn` or `${Aws.PARTITION}`/`${Aws.REGION}`/`${Aws.ACCOUNT_ID}` tokens):
1. `iot:Connect` on `arn:...:client/${iot:Connection.Thing.ThingName}`
2. `iot:Publish` on `topic/fleet/${iot:Connection.Thing.ThingName}/telemetry` and `topic/fleet/${iot:Connection.Thing.ThingName}/status`
(The literal `${iot:Connection.Thing.ThingName}` must survive CDK token resolution; build the string with `'${iot:Connection.Thing.ThingName}'` in single quotes, not a template literal.)

- [ ] **Step 1: Failing tests**
  - `fleet-topic-rule.test.ts`: synthesized `AWS::IoT::TopicRule` has `TopicRulePayload.ErrorAction` and `AwsIotSqlVersion: '2016-03-23'`; one `AWS::CloudWatch::Alarm` with `MetricName: 'Failure'`, `Namespace: 'AWS/IoT'`, dimension `RuleName`; `new FleetTopicRule(stack, 'X', { ...props, errorAction: undefined as never })` throws `errorAction is required`; a `// @ts-expect-error` line constructing it without `errorAction` keeps the type requirement honest.
  - `device-policy.test.ts`: the policy JSON contains exactly two statements; no `Action` equals `iot:*`; every `Resource` contains `${iot:Connection.Thing.ThingName}`; there is no `iot:Subscribe`/`iot:Receive`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `pnpm --filter @iot-telemetry/infra test` -> pass.
- [ ] **Step 5: Commit** `feat(infra): FleetTopicRule construct requiring error actions and least-privilege device policy`

---

### Task 21: infra - `FleetStack`, cdk-nag, synth gate

**Files:**
- Create: `infra/lib/fleet-stack.ts`, `infra/bin/app.ts`
- Test: `infra/test/fleet-stack.test.ts`, `infra/test/nag.test.ts`

**Interfaces:**
```ts
export interface FleetStackProps extends StackProps { alertCode?: lambda.Code; dwellSeconds?: number; minExitSeconds?: number }
export class FleetStack extends Stack {}   // default alertCode = lambda.Code.fromAsset(<repo>/packages/alert-lambda/dist-lambda)
```
`bin/app.ts`: `const app = new App(); new FleetStack(app, 'IotTelemetryFleet'); Validations.of(app).addPlugins(new AwsSolutionsChecks(app));` Resolve the asset path from `import.meta.url` (`fileURLToPath`).

Stack contents (all names from the spec; prototype on 2026-10-04 synthesized these resource types with aws-cdk-lib 2.272.0):
- S3: `AccessLogs` bucket (target for server access logs of the others), `History`, `Quarantine`, `RuleErrors`; all `enforceSSL`, `BLOCK_ALL`, `S3_MANAGED`, `serverAccessLogsBucket: accessLogs` (except AccessLogs itself).
- Firehose: `firehose.DeliveryStream` with `new firehose.S3Bucket(history, { dataOutputPrefix: 'telemetry/', bufferingInterval: Duration.seconds(60) })`, `encryption: firehose.StreamEncryption.awsOwnedKey()`.
- DynamoDB: `Latest` (`TableV2`, pk `vehicleId` S, PITR on), `AlertState` (`TableV2`, pk `pk` S, sk `sk` S, GSI `pending-index` pk `pending` S sk `pk` S, PITR on).
- Location: `CfnTracker` `fleet` (`positionFiltering: 'DistanceBased'`, `eventBridgeEnabled: false`), `CfnGeofenceCollection` `fleet-geofences`, `CfnTrackerConsumer` (use `consumer.node.addDependency(tracker)`; `CfnResource#addDependency` is deprecated).
- IAM: one `RuleRole` (`iot.amazonaws.com`) with `history` Firehose `grantPutRecords`, `latest.grantWriteData`, `quarantine.grantPut`, `ruleErrors.grantPut`, and `geo:BatchUpdateDevicePosition` on the tracker ARN only.
- Rules via `FleetTopicRule` with SQL **imported from `@iot-telemetry/schema`**: `telemetry_to_history` (firehose `separator: '\n'` + `dynamoDBv2 putItem latest`), `position_to_location` (location action: `deviceId: '${vehicleId}'`, `latitude: '${lat}'`, `longitude: '${lon}'`, `timestamp: { value: '${time_to_epoch(ts, "' + TS_PATTERN + '")}', unit: 'MILLISECONDS' }`), `invalid_to_quarantine` (s3 `key: '${topic()}/${timestamp()}.json'`). Every rule's `errorAction` is S3 to `RuleErrors` with key `'${ruleName}/${timestamp()}-${newuuid()}.json'` (literal rule name).
- `DevicePolicy`.
- SNS `fleet-alerts` topic: `enforceSSL: true`, `masterKey: kms.Alias.fromAliasName(this, 'SnsKey', 'alias/aws/sns')`.
- Lambda `AlertFn`: `NODEJS_24_X`, handler `index.handler`, `code: props.alertCode`, memory 256, timeout 30 s, env `TABLE_NAME`, `TOPIC_ARN`, `DWELL_SECONDS`, `MIN_EXIT_SECONDS`; `alertState.grantReadWriteData(fn)`, `topic.grantPublish(fn)`; explicit `logs.LogGroup` with 1-month retention.
- EventBridge: rule `{ source: ['aws.geo'], detailType: ['Location Geofence Event'] }` -> `AlertFn`; rule `Schedule.rate(Duration.minutes(1))` -> `AlertFn` with `RuleTargetInput.fromObject({ source: 'iot-telemetry.sweep' })`.
- cdk-nag: fix findings first. Acknowledge only with `Validations.of(<construct>).acknowledge({ id, reason })` and a concrete reason. Expected acknowledgements: `AwsSolutions-S1` on `AccessLogs` (it is the log target); `AwsSolutions-IAM5` findings that are object-level `bucket/*` or table `index/*` grants from CDK `grant*` helpers; `AwsSolutions-IAM4` for `AWSLambdaBasicExecutionRole` if CDK adds it. List every acknowledgement in a `Ruling:` ledger line.

- [ ] **Step 1: Failing tests**
  - `fleet-stack.test.ts` (stack built with `alertCode: lambda.Code.fromInline('export const handler = async () => {}')`): exactly 3 `AWS::IoT::TopicRule`, each with `ErrorAction`; their `Sql` values equal the three schema constants; no resource type starts with `AWS::Timestream::`; one `AWS::Location::Tracker`, one `AWS::Location::GeofenceCollection`, one `AWS::Location::TrackerConsumer`; an `AWS::Events::Rule` whose `EventPattern` matches `{ source: ['aws.geo'], 'detail-type': ['Location Geofence Event'] }`; an `AWS::Events::Rule` with `ScheduleExpression: 'rate(1 minute)'` whose target `Input` is `{"source":"iot-telemetry.sweep"}`; `AlertState` has GSI `pending-index`; Lambda env has the 4 keys; 3 `AWS::CloudWatch::Alarm`; the rule role policy has no `Action: '*'` and no `Resource: '*'`.
  - `nag.test.ts`: `const app = new App(); new FleetStack(app, 'T', { alertCode: lambda.Code.fromInline(...) }); Validations.of(app).addPlugins(new AwsSolutionsChecks(app)); expect(() => app.synth()).not.toThrow();` (on failure the thrown message names `validation-report.json`; read it to see findings).
- [ ] **Step 2:** FAIL. **Step 3:** implement until both pass.
- [ ] **Step 4:** `pnpm synth` -> exit 0 (bundles the Lambda, then `cdk synth --quiet`); `infra/cdk.out/IotTelemetryFleet.template.json` exists. `pnpm --filter @iot-telemetry/infra test` -> pass.
- [ ] **Step 5: Commit** `feat(infra): fleet stack with IoT rules, Location, alert Lambda and cdk-nag gate`

---

### Task 22: bench - measured latency and alert correctness

**Files:**
- Create: `bench/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}` (name `@iot-telemetry/bench`, private; dependencies: workspace `schema`, `alert-core`, `alert-lambda`, `sim`, `local-pipeline`, plus `mqtt 5.16.0`; scripts `build`, `typecheck`, `test`, `test:int` (`--passWithNoTests`), `bench` (`node dist/run.js`))
- Create: `bench/src/stats.ts`, `src/timelines.ts`, `src/alerts-bench.ts`, `src/latency-bench.ts`, `src/run.ts`, `src/index.ts`
- Test: `bench/test/stats.test.ts`, `bench/test/alerts-bench.test.ts`
- Create (measured): `bench/results/latest.json`

**Interfaces:**
```ts
// stats.ts
export function percentile(sortedAsc: number[], p: number): number;   // nearest-rank; throws on empty
export function summarize(samples: number[]): { n: number; p50: number; p95: number; p99: number; max: number; mean: number };
// timelines.ts
export function randomTimeline(rng: Rng, opts: { maxEvents: number }): GeofenceEvent[];     // same generator shape as the alert-core arbitrary
export function withDuplicates(rng: Rng, events: GeofenceEvent[], rate: number): GeofenceEvent[];
export function shuffleWithinWindow(rng: Rng, events: GeofenceEvent[], windowMs: number): GeofenceEvent[];
// alerts-bench.ts
export interface AlertsBenchResult {
  timelines: number; deliveries: number; naiveAlerts: number; coreAlerts: number; referenceCrossings: number;
  duplicateAlerts: number; missedAlerts: number;
  reorder: { windowMs: number; invariantViolations: number; lateIgnored: number; missedVsReference: number };
  loiter: { naiveAlerts: number; coreAlerts: number };
}
export async function runAlertsBench(opts: { timelines: number; seed: number; duplicateRate: number }): Promise<AlertsBenchResult>;
// latency-bench.ts
export interface LatencyBenchResult { vehicles: number; hz: number; durationS: number; sent: number; received: number; latencyMs: ReturnType<typeof summarize> }
export async function runLatencyBench(opts: { mqttUrl: string; wsUrl: string; vehicles: number; hz: number; durationS: number }): Promise<LatencyBenchResult>;
```
- Alerts bench: for each timeline, horizon = last ts + 300 s; `duplicateAlerts` = core alert ids not matching a reference alert (by type+confirmedAt) plus repeated ids; `missedAlerts` = reference alerts not produced; naive = ENTER deliveries. Reorder pass: shuffle within 10 s, check the three safety invariants (count violations), sum `late_ignored`, count misses vs reference. `loiter` calls `simulateScenarios({ scenarios: ['loiter'], duplicateRate: 0.2 })` from `@iot-telemetry/local-pipeline` and reports `stats.naiveAlerts` and `alerts.length`.
- Latency bench: `runFleet` with `RealClock`, `MqttFleetSink({ url, onPublish })` recording `(vehicleId:seq) -> t0`; one WS subscriber on `fleet/+/telemetry` records `t1 = performance.timeOrigin + performance.now()` on receipt; latency `t1 - t0`; wait 3 s after the run for stragglers; `received` counts matched samples. Same process, same clock.
- `run.ts`: CLI `--only alerts|latency|all` (default all), `--vehicles 200 --hz 1 --duration 60 --timelines 1000 --seed 42`; env `MQTT_URL`, `MQTT_WS_URL`; writes `bench/results/latest.json`:
  `{ "measuredAt": ISO, "environment": { "node": process.version, "platform": process.platform, "broker": "eclipse-mosquitto:2.1.2-alpine", "where": process.env.BENCH_WHERE ?? "host" }, "latency": {...}, "alerts": {...} }`. Merge with the existing file when `--only` is used.
- [ ] **Step 1: Failing tests:** `stats.test.ts` (nearest-rank on 1..100: p50=50, p99=99, p100=100; empty throws); `alerts-bench.test.ts`: 50 timelines seed 1 -> `duplicateAlerts === 0`, `missedAlerts === 0`, `reorder.invariantViolations === 0`, `naiveAlerts > coreAlerts`, deterministic across two runs.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `pnpm --filter @iot-telemetry/bench test` -> pass.
- [ ] **Step 5: Measure (canonical run in compose):** add `BENCH_WHERE: compose` to the compose `bench` environment, then
```powershell
docker compose build pipeline
docker compose up -d mosquitto
docker compose --profile bench run --rm bench
docker compose down
Get-Content bench/results/latest.json
```
Expected: `latency.sent` = 12000, `latency.received` = 12000 (report the real value if not), `alerts.duplicateAlerts` = 0, `alerts.missedAlerts` = 0, `alerts.reorder.invariantViolations` = 0. Do not edit the file by hand. Copy the key numbers into the ledger.
- [ ] **Step 6: Commit** `feat(bench): measured publish latency and alert correctness benchmark` (include `bench/results/latest.json`)

---

### Task 23: CI workflow, README, LICENSE

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`, `LICENSE` (MIT, 2026 Sathwik Bairaboina)

`ci.yml` jobs (ubuntu-latest, `actions/checkout@v4`, `pnpm/action-setup@v4` with `version: 9.12.0`, `actions/setup-node@v4` with `node-version: 24`, `cache: pnpm`):
1. `check`: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm synth`, `pnpm --filter @iot-telemetry/alert-core pack --dry-run`.
2. `integration` (needs check): `docker compose up -d --wait mosquitto dynamodb`, then `pnpm test:int` with `IOT_IT_MQTT_URL: mqtt://localhost:5370`, `IOT_IT_MQTT_WS_URL: ws://localhost:5371`, `IOT_IT_DYNAMO_URL: http://localhost:5372`, then `docker compose down` (`if: always()`).
No secrets are needed. Validate locally with `docker run --rm -v "${PWD}:/repo" rhysd/actionlint:1.7.7 -color /repo/.github/workflows/ci.yml` if that image tag pulls; otherwise parse the YAML with `node -e "require('yaml')"`-free check `npx --yes js-yaml .github/workflows/ci.yml` and record which check ran.

`README.md` (numbers only from `bench/results/latest.json`; quote them exactly):
1. Title + the headline sentence from the spec template with measured values + `![Live fleet map](docs/media/map.png)`.
2. "Run it in 2 minutes": `docker compose up -d --build` then open `http://localhost:5373`; what you will see (vehicles, depot, the loiter vehicle producing exactly one ENTERED after ~2 minutes).
3. Why: duplicates and loiter make naive geofence alerting noisy; the core's guarantees and limits (from the spec).
4. Architecture: one ```mermaid flowchart (sim -> Mosquitto/IoT Core -> rules (shared SQL) -> history / Location (stub) -> EventBridge -> alert adapter -> DynamoDB / SNS; map over MQTT-WS).
5. Install the alert core: `npm i @iot-telemetry/alert-core` + 10-line example. (Note: not yet published to npm; `pnpm --filter @iot-telemetry/alert-core pack` builds the tarball.)
6. Benchmark table: every field of `latest.json` that matters, with `measuredAt` and environment, and the exact command to reproduce.
7. Decisions: one line per ADR with link.
8. Limits (honest): no AWS deploy test, Mosquitto has no auth, synthetic routes, Timestream replaced, cloud dwell lag up to 60 s, at-least-once SNS.
9. Development: the Gates block from the spec.
- [ ] **Step 1:** write files. **Step 2:** check every number in README against `latest.json` with a script: `node -e` that loads the JSON and asserts each quoted number string appears in README.md; record the output. **Step 3:** `pnpm lint` exit 0.
- [ ] **Step 4: Commit** `docs: README with measured headline, CI workflow and license`

---

### Task 24: Final gates and handoff

**Files:**
- Create/append: `docs/handoff.md`
- Ledger: final line

- [ ] **Step 1: Run every gate** from the spec's Gates section, in order, from a clean state (`git status --short` empty except ignored files). Paste the real tail of each output into the ledger, e.g. `FINAL: lint ok; typecheck ok; test <N> passed/<M> skipped; build ok; synth ok; pack 6 files; test:int <N> passed; compose build ok`.
- [ ] **Step 2: Compose smoke:** `docker compose up -d --build`; after 180 s: `curl.exe -s -o NUL -w "%{http_code}" http://localhost:5373` -> `200`; `docker compose logs pipeline | Select-String "ALERT ENTERED veh-9001"` -> 1 line; `docker compose ps --format "{{.Name}}"` all start with `iot-telemetry-`; `docker compose down`; `docker ps -a --filter name=iot-telemetry` -> empty.
- [ ] **Step 3: Secrets check:** `git ls-files | Select-String -Pattern '\.env$|\.pem$|certs/'` -> nothing; `git grep -n -I -E "AKIA[0-9A-Z]{16}|BEGIN (RSA|EC) PRIVATE KEY"` -> nothing.
- [ ] **Step 4: Handoff:** append to `docs/handoff.md`: `## 2026-10-04 - Claude (Sonnet builder) - main`, what changed (one line per package), what is left (v0.2 list from the spec), how to verify (Gates + compose smoke), and the measured headline numbers.
- [ ] **Step 5: Commit** `docs: v0.1 handoff and final gate results`
