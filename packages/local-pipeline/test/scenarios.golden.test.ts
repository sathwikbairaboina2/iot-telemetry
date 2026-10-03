import { describe, expect, test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { simulateScenarios } from '../src/index.js';

const goldenPath = (name: string) => fileURLToPath(new URL(`./golden/${name}.json`, import.meta.url));
function checkGolden(name: string, actual: unknown) {
  if (process.env.UPDATE_GOLDEN === '1') writeFileSync(goldenPath(name), JSON.stringify(actual, null, 2) + '\n');
  expect(actual).toEqual(JSON.parse(readFileSync(goldenPath(name), 'utf8')));
}

describe('loiter', () => {
  test('exactly one ENTERED and one EXITED where naive alerting fires many times', async () => {
    const r = await simulateScenarios({ scenarios: ['loiter'] });
    expect(r.alerts.filter((a) => a.vehicleId === 'veh-9001').map((a) => a.type)).toEqual(['ENTERED', 'EXITED']);
    expect(r.stats.naiveAlerts).toBeGreaterThanOrEqual(6);
    console.log(`loiter: naiveAlerts=${r.stats.naiveAlerts} coreAlerts=${r.alerts.length}`);
    checkGolden('loiter', { alerts: r.alerts, stats: r.stats });
  });
  test('duplicate deliveries do not change the alerts', async () => {
    const clean = await simulateScenarios({ scenarios: ['loiter'] });
    const dup = await simulateScenarios({ scenarios: ['loiter'], duplicateRate: 0.5 });
    expect(dup.stats.duplicateDeliveries).toBeGreaterThan(0);
    expect(dup.alerts).toEqual(clean.alerts);
  });
});

describe('tunnel', () => {
  test('a radio outage across the entry gives the same alerts as an uninterrupted run', async () => {
    const withOutage = await simulateScenarios({ scenarios: ['tunnel'] });
    const control = await simulateScenarios({ scenarios: ['tunnel'], outages: false });
    expect(withOutage.fleet.buffered).toBe(90);
    expect(withOutage.alerts.length).toBeGreaterThan(0);
    expect(withOutage.alerts).toEqual(control.alerts);
    const seqs = withOutage.history.filter((t) => t.vehicleId === 'veh-9002').map((t) => t.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 400 }, (_, i) => i));
    checkGolden('tunnel', { alerts: withOutage.alerts, stats: withOutage.stats });
  });
});
