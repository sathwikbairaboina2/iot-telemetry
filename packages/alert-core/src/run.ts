import { step } from './step.js';
import { initialState } from './types.js';
import type { Alert, AlertConfig, CoreEvent, PairState, StepOutcome } from './types.js';

export interface RunResult { state: PairState; alerts: Alert[]; counts: Record<StepOutcome, number> }

/** Fold `step` over a sequence of events for one (vehicle, geofence) pair. */
export function run(events: readonly CoreEvent[], config: AlertConfig, initial: PairState = initialState): RunResult {
  let state = initial;
  const alerts: Alert[] = [];
  const counts: Record<StepOutcome, number> = { applied: 0, redundant: 0, duplicate: 0, late_ignored: 0, tick: 0 };
  for (const ev of events) {
    const r = step(state, ev, config);
    state = r.state;
    alerts.push(...r.emitted);
    counts[r.outcome] += 1;
  }
  return { state, alerts, counts };
}
