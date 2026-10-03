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
