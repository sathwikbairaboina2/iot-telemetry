import { expect, test } from 'vitest';
import { run, type GeofenceEvent } from '../src/index.js';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}

test('same frozen input twice gives equal results and is not mutated', () => {
  const events: GeofenceEvent[] = Array.from({ length: 500 }, (_, i) => ({
    kind: i % 2 === 0 ? 'ENTER' : 'EXIT', eventId: `e${i}`, vehicleId: 'v', geofenceId: 'g', deviceTs: i * 20_000,
  }));
  const frozen = deepFreeze(structuredClone(events));
  const a = run(frozen, { dwellMs: 60_000, minExitMs: 30_000 });
  const b = run(frozen, { dwellMs: 60_000, minExitMs: 30_000 });
  expect(a).toEqual(b);
  expect(frozen).toEqual(events);
});
