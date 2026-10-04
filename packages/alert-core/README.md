# @iot-telemetry/alert-core

A pure state machine that turns noisy, duplicated geofence ENTER/EXIT events into exactly one alert per real crossing.
It has no clock, no IO and no runtime dependencies. Time arrives as event fields, so the same input always gives the
same output.

Naive geofence alerting fires on every raw ENTER delivery. GPS jitter at a boundary and at-least-once delivery
(EventBridge, MQTT QoS 1) turn one crossing into many alerts. This core debounces the raw signal instead.

## Install

```sh
npm i @iot-telemetry/alert-core
```

Not yet published to npm. Run `pnpm --filter @iot-telemetry/alert-core pack` in the repo to build the tarball.

## Usage

```ts
import { run, step, initialState, DEFAULT_CONFIG, type CoreEvent } from '@iot-telemetry/alert-core';

const events: CoreEvent[] = [
  { kind: 'ENTER', eventId: 'a', vehicleId: 'v1', geofenceId: 'depot', deviceTs: 0 },
  { kind: 'ENTER', eventId: 'a', vehicleId: 'v1', geofenceId: 'depot', deviceTs: 0 }, // redelivery: ignored
  { kind: 'TICK', vehicleId: 'v1', geofenceId: 'depot', deviceTs: 61_000 },           // time passes
];

const { alerts } = run(events, DEFAULT_CONFIG);
// [{ alertId: 'v1:depot:ENTERED:60000', type: 'ENTERED', confirmedAt: 60000, ... }]

// Or one event at a time, keeping the state yourself:
const r = step(initialState, events[0]!, DEFAULT_CONFIG); // { state, emitted, outcome }
```

## Semantics

- One state per (vehicle, geofence) pair: `OUTSIDE`, `PENDING_IN`, `INSIDE`, `PENDING_OUT`.
- `ENTERED` is emitted once the raw signal has been inside for `dwellMs` (default 60 s).
  `EXITED` is emitted once it has been outside for `minExitMs` (default 30 s).
- A short loiter at the boundary never confirms; a short exit while inside is absorbed.
- Redelivered events (same `eventId` at the same timestamp) are `duplicate` and change nothing.
- Events older than the last applied one are `late_ignored` and change nothing.
- `TICK` events carry only a timestamp; they let time confirm a pending state without a new geofence event.
- `alertId` is `{vehicleId}:{geofenceId}:{type}:{confirmedAt}`, deterministic, so it works as a database key.

## Guarantees and limits

- Safety under any reordering: alerts alternate ENTERED/EXITED starting with ENTERED, `confirmedAt` never decreases,
  alert ids are unique, and a late event never changes state.
- Completeness only for timestamp-sorted delivery (any number of redeliveries): the output equals an independent
  reference model on 3,000 fuzzed timelines. Under reordering, events dropped as late are reported in the outcome
  counts, not hidden, and some real crossings can be missed.
- There is no reorder buffer in v0.1.

## Test oracle

`referenceAlerts(events, horizon, config)` is exported too. It is an independent, deliberately simple model of the same
semantics that the tests and the benchmark compare `step()` against. It is public so you can fuzz your own integration
the same way, but it is a test oracle, not a second implementation to run in production.

MIT licensed.
