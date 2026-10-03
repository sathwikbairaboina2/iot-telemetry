import { initialState, isPending, type Alert, type PairState } from '@iot-telemetry/alert-core';
import type { AlertPublisher, AlertStateRepo, CommitResult, PairRef, StoredState } from './repo.js';

const key = (v: string, g: string): string => `${v}\u0000${g}`;

export class MemoryAlertStateRepo implements AlertStateRepo {
  private readonly states = new Map<string, StoredState & PairRef>();
  private readonly stored: Alert[] = [];
  private readonly ids = new Set<string>();

  /** `beforeCommit` lets tests yield between load and commit to force interleavings. */
  constructor(private readonly opts: { beforeCommit?: () => Promise<void> } = {}) {}

  async load(vehicleId: string, geofenceId: string): Promise<StoredState> {
    const s = this.states.get(key(vehicleId, geofenceId));
    return s ? { state: s.state, version: s.version } : { state: initialState, version: 0 };
  }

  async commit(vehicleId: string, geofenceId: string, expectedVersion: number, next: PairState, alerts: readonly Alert[]): Promise<CommitResult> {
    await this.opts.beforeCommit?.();
    const k = key(vehicleId, geofenceId);
    const current = this.states.get(k)?.version ?? 0;
    if (current !== expectedVersion || alerts.some((a) => this.ids.has(a.alertId))) return 'conflict';
    this.states.set(k, { state: next, version: current + 1, vehicleId, geofenceId });
    for (const a of alerts) { this.ids.add(a.alertId); this.stored.push(a); }
    return 'ok';
  }

  async listPending(): Promise<PairRef[]> {
    return [...this.states.values()].filter((s) => isPending(s.state)).map(({ vehicleId, geofenceId }) => ({ vehicleId, geofenceId }));
  }

  /** Committed alert records, in commit order. */
  alerts(): Alert[] { return [...this.stored]; }
}

export class CollectingPublisher implements AlertPublisher {
  readonly published: Alert[] = [];
  async publish(alert: Alert): Promise<void> { this.published.push(alert); }
}
