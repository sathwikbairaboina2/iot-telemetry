import { expect, test } from 'vitest';
import { run, step, initialState, type Alert, type CoreEvent, type PairState } from '../src/index.js';
const cfg = { dwellMs: 60_000, minExitMs: 30_000 };
const events: CoreEvent[] = [
  { kind: 'ENTER', eventId: 'a', vehicleId: 'v', geofenceId: 'g', deviceTs: 0 },
  { kind: 'ENTER', eventId: 'a', vehicleId: 'v', geofenceId: 'g', deviceTs: 0 },
  { kind: 'ENTER', eventId: 'b', vehicleId: 'v', geofenceId: 'g', deviceTs: 5000 },
  { kind: 'EXIT', eventId: 'old', vehicleId: 'v', geofenceId: 'g', deviceTs: 1000 },
  { kind: 'TICK', vehicleId: 'v', geofenceId: 'g', deviceTs: 70_000 },
];

test('run counts outcomes, zero-filled', () => {
  const r = run(events, cfg);
  expect(r.counts).toEqual({ applied: 1, redundant: 1, duplicate: 1, late_ignored: 1, tick: 1 });
  expect(run([], cfg).counts).toEqual({ applied: 0, redundant: 0, duplicate: 0, late_ignored: 0, tick: 0 });
});
test('run equals folding step by hand', () => {
  let s: PairState = initialState; const alerts: Alert[] = [];
  for (const e of events) { const x = step(s, e, cfg); s = x.state; alerts.push(...x.emitted); }
  const r = run(events, cfg);
  expect(r.state).toEqual(s); expect(r.alerts).toEqual(alerts);
});
