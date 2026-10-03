import { expect, test } from 'vitest';
import { runAlertsBench } from '../src/index.js';

test('50 seeded timelines: no duplicates, no misses, no reorder violations, and naive alerts exceed the core', async () => {
  const r = await runAlertsBench({ timelines: 50, seed: 1, duplicateRate: 0.2 });
  expect(r.duplicateAlerts).toBe(0);
  expect(r.missedAlerts).toBe(0);
  expect(r.reorder.invariantViolations).toBe(0);
  expect(r.naiveAlerts).toBeGreaterThan(r.coreAlerts);
  expect(r.coreAlerts).toBe(r.referenceCrossings);
  expect(r.loiter.coreEntered).toBe(1);
});

test('the run is deterministic', async () => {
  const a = await runAlertsBench({ timelines: 20, seed: 7, duplicateRate: 0.2 });
  const b = await runAlertsBench({ timelines: 20, seed: 7, duplicateRate: 0.2 });
  expect(a).toEqual(b);
});
