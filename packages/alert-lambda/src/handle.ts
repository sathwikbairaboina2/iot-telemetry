import { step, type Alert, type AlertConfig, type CoreEvent, type PairState, type StepOutcome } from '@iot-telemetry/alert-core';
import type { AlertPublisher, AlertStateRepo } from './repo.js';

export interface HandleDeps { repo: AlertStateRepo; publisher: AlertPublisher; config: AlertConfig; maxAttempts?: number }
export interface HandleResult { outcome: StepOutcome; emitted: Alert[]; state: PairState; attempts: number }

export class ConcurrencyError extends Error {}

/**
 * Load, step, commit with the version we loaded. A conflict means another invocation won the race: reload and step
 * again (a duplicate or already-confirmed result then commits nothing). Alerts are published only after a commit.
 */
export async function handleCoreEvent(event: CoreEvent, deps: HandleDeps): Promise<HandleResult> {
  const maxAttempts = deps.maxAttempts ?? 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { state, version } = await deps.repo.load(event.vehicleId, event.geofenceId);
    const r = step(state, event, deps.config);
    const nothingToWrite = r.outcome === 'late_ignored' || r.outcome === 'duplicate' || (r.outcome === 'tick' && r.emitted.length === 0);
    if (nothingToWrite) return { outcome: r.outcome, emitted: [], state: r.state, attempts: attempt };
    const res = await deps.repo.commit(event.vehicleId, event.geofenceId, version, r.state, r.emitted);
    if (res === 'ok') {
      for (const a of r.emitted) await deps.publisher.publish(a);
      return { outcome: r.outcome, emitted: r.emitted, state: r.state, attempts: attempt };
    }
  }
  throw new ConcurrencyError(`gave up after ${maxAttempts} conflicting attempts for ${event.vehicleId}/${event.geofenceId}`);
}
