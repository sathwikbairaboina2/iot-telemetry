import { DEFAULT_CONFIG, referenceAlerts, run, type Alert, type CoreEvent, type GeofenceEvent } from '@iot-telemetry/alert-core';
import { simulateScenarios } from '@iot-telemetry/local-pipeline';
import { mulberry32 } from '@iot-telemetry/sim';
import { randomTimeline, shuffleWithinWindow, withDuplicates } from './timelines.js';

export interface AlertsBenchResult {
  timelines: number; deliveries: number; naiveAlerts: number; coreAlerts: number; coreEntered: number; referenceCrossings: number;
  duplicateAlerts: number; missedAlerts: number;
  reorder: { windowMs: number; invariantViolations: number; lateIgnored: number; missedVsReference: number };
  loiter: { naiveAlerts: number; coreAlerts: number; coreEntered: number };
}

const REORDER_WINDOW_MS = 10_000;
const key = (a: { type: string; confirmedAt: number }): string => `${a.type}@${a.confirmedAt}`;

function invariantViolations(alerts: Alert[]): number {
  let n = 0;
  alerts.forEach((a, i) => {
    if (a.type !== (i % 2 === 0 ? 'ENTERED' : 'EXITED')) n++;
    if (i > 0 && a.confirmedAt < alerts[i - 1]!.confirmedAt) n++;
  });
  n += alerts.length - new Set(alerts.map((a) => a.alertId)).size;
  return n;
}

const tickAt = (ts: number): CoreEvent => ({ kind: 'TICK', vehicleId: 'v', geofenceId: 'g', deviceTs: ts });

/**
 * naiveAlerts counts every raw ENTER delivery (what an alert-per-event system would send). coreAlerts counts
 * ENTERED + EXITED from the core, coreEntered only the ENTERED ones, so the two are comparable.
 */
export async function runAlertsBench(opts: { timelines: number; seed: number; duplicateRate: number }): Promise<AlertsBenchResult> {
  const rng = mulberry32(opts.seed);
  const r: AlertsBenchResult = {
    timelines: opts.timelines, deliveries: 0, naiveAlerts: 0, coreAlerts: 0, coreEntered: 0, referenceCrossings: 0,
    duplicateAlerts: 0, missedAlerts: 0,
    reorder: { windowMs: REORDER_WINDOW_MS, invariantViolations: 0, lateIgnored: 0, missedVsReference: 0 },
    loiter: { naiveAlerts: 0, coreAlerts: 0, coreEntered: 0 },
  };
  for (let t = 0; t < opts.timelines; t++) {
    const events: GeofenceEvent[] = randomTimeline(rng, { maxEvents: 25 });
    const delivered = withDuplicates(rng, events, opts.duplicateRate);
    const horizon = events[events.length - 1]!.deviceTs + 300_000;
    const reference = referenceAlerts(events, horizon, DEFAULT_CONFIG);
    const refKeys = new Set(reference.map(key));

    r.deliveries += delivered.length;
    r.naiveAlerts += delivered.filter((e) => e.kind === 'ENTER').length;
    r.referenceCrossings += reference.length;

    const sorted = run([...delivered, tickAt(horizon)], DEFAULT_CONFIG);
    r.coreAlerts += sorted.alerts.length;
    r.coreEntered += sorted.alerts.filter((a) => a.type === 'ENTERED').length;
    const coreKeys = new Set(sorted.alerts.map(key));
    r.duplicateAlerts += sorted.alerts.filter((a) => !refKeys.has(key(a))).length + (sorted.alerts.length - new Set(sorted.alerts.map((a) => a.alertId)).size);
    r.missedAlerts += reference.filter((a) => !coreKeys.has(key(a))).length;

    const shuffled = shuffleWithinWindow(rng, delivered, REORDER_WINDOW_MS);
    const reordered = run([...shuffled, tickAt(horizon)], DEFAULT_CONFIG);
    r.reorder.invariantViolations += invariantViolations(reordered.alerts);
    r.reorder.lateIgnored += reordered.counts.late_ignored;
    const reKeys = new Set(reordered.alerts.map(key));
    r.reorder.missedVsReference += reference.filter((a) => !reKeys.has(key(a))).length;
  }

  const loiter = await simulateScenarios({ scenarios: ['loiter'], duplicateRate: 0.2 });
  r.loiter = {
    naiveAlerts: loiter.stats.naiveAlerts,
    coreAlerts: loiter.alerts.length,
    coreEntered: loiter.alerts.filter((a) => a.type === 'ENTERED').length,
  };
  return r;
}
