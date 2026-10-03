import { expect, test } from 'vitest';
import { referenceAlerts, type GeofenceEvent } from '../src/index.js';
const cfg = { dwellMs: 60_000, minExitMs: 30_000 };
const ev = (kind: 'ENTER' | 'EXIT', id: string, s: number): GeofenceEvent => ({ kind, eventId: id, vehicleId: 'v', geofenceId: 'g', deviceTs: s * 1000 });

test('empty', () => { expect(referenceAlerts([], 1000, cfg)).toEqual([]); });
test('dwell not reached', () => { expect(referenceAlerts([ev('ENTER', 'a', 0)], 59_000, cfg)).toEqual([]); });
test('dwell reached at horizon', () => {
  expect(referenceAlerts([ev('ENTER', 'a', 0)], 60_000, cfg)).toEqual([{ type: 'ENTERED', confirmedAt: 60_000 }]);
});
test('loiter yields nothing', () => {
  const e = [ev('ENTER', 'a', 0), ev('EXIT', 'b', 5), ev('ENTER', 'c', 10), ev('EXIT', 'd', 15)];
  expect(referenceAlerts(e, 200_000, cfg)).toEqual([]);
});
test('enter then exit', () => {
  expect(referenceAlerts([ev('ENTER', 'a', 0), ev('EXIT', 'b', 100)], 130_000, cfg))
    .toEqual([{ type: 'ENTERED', confirmedAt: 60_000 }, { type: 'EXITED', confirmedAt: 130_000 }]);
});
test('duplicate ids are ignored', () => {
  const a = ev('ENTER', 'a', 0);
  expect(referenceAlerts([a, a, a], 60_000, cfg)).toEqual([{ type: 'ENTERED', confirmedAt: 60_000 }]);
});
