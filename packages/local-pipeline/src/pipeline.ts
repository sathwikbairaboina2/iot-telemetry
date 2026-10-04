import { isPending, type Alert, type AlertConfig, type StepOutcome } from '@iot-telemetry/alert-core';
import { handleCoreEvent, toCoreEvent, type AlertPublisher, type AlertStateRepo, type HandleResult } from '@iot-telemetry/alert-lambda';
import type { Telemetry } from '@iot-telemetry/schema';
import { GeofenceStub, type Geofence } from './geofence-stub.js';
import { routeMessage } from './router.js';
import type { QuarantineRecord, Sink } from './sinks.js';

export interface PipelineDeps {
  repo: AlertStateRepo; publisher: AlertPublisher; config: AlertConfig; geofences: Geofence[];
  history: Sink<Telemetry>; quarantine: Sink<QuarantineRecord>; duplicateRate?: number; seed?: number;
  /** Default `() => new Date().toISOString()`; tests pass a fixed value. */
  receivedAt?: () => string;
}

export interface PipelineStats {
  received: number; valid: number; quarantined: number; schemaViolations: number;
  geofenceEvents: number; duplicateDeliveries: number; naiveAlerts: number; alerts: number;
  outcomes: Record<StepOutcome, number>;
}

export interface Pipeline {
  /** Callers must await in arrival order. */
  handle(topic: string, payload: string | Uint8Array): Promise<void>;
  latest(): ReadonlyMap<string, Telemetry>;
  stats(): PipelineStats;
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const stub = new GeofenceStub(deps.geofences, { duplicateRate: deps.duplicateRate, seed: deps.seed });
  const latest = new Map<string, Telemetry>();
  const pending = new Map<string, Set<string>>();
  const counts = { received: 0, valid: 0, quarantined: 0, schemaViolations: 0, geofenceEvents: 0, naiveAlerts: 0, alerts: 0 };
  const outcomes: Record<StepOutcome, number> = { applied: 0, redundant: 0, duplicate: 0, late_ignored: 0, tick: 0 };

  const publisher: AlertPublisher = {
    async publish(alert: Alert) { counts.alerts++; await deps.publisher.publish(alert); },
  };
  const handleDeps = { repo: deps.repo, publisher, config: deps.config };

  // The pending index is memory only, so rebuild it once from the repo: a restart must not strand an in-progress dwell.
  let seeded: Promise<void> | undefined;
  const seedPending = (): Promise<void> => (seeded ??= deps.repo.listPending().then((pairs) => {
    for (const { vehicleId, geofenceId } of pairs) {
      const set = pending.get(vehicleId) ?? new Set<string>();
      set.add(geofenceId);
      pending.set(vehicleId, set);
    }
  }));

  const track = (r: HandleResult, vehicleId: string, geofenceId: string): void => {
    outcomes[r.outcome]++;
    const set = pending.get(vehicleId) ?? new Set<string>();
    if (isPending(r.state)) set.add(geofenceId); else set.delete(geofenceId);
    pending.set(vehicleId, set);
  };

  return {
    async handle(topic, payload) {
      await seedPending();
      counts.received++;
      const routed = routeMessage(topic, payload);
      if (routed.kind === 'quarantine') {
        counts.quarantined++;
        await deps.quarantine.write({ topic, receivedAt: (deps.receivedAt ?? (() => new Date().toISOString()))(), reason: routed.reason, raw: routed.raw });
        return;
      }
      const t = routed.telemetry;
      counts.valid++;
      if (routed.schemaErrors.length > 0) counts.schemaViolations++;
      await deps.history.write(t);
      const prev = latest.get(t.vehicleId);
      if (!prev || t.seq > prev.seq) latest.set(t.vehicleId, t);

      for (const e of stub.evaluate(t)) {
        counts.geofenceEvents++;
        if (e.detail.EventType === 'ENTER') counts.naiveAlerts++;
        track(await handleCoreEvent(toCoreEvent(e), handleDeps), e.detail.DeviceId, e.detail.GeofenceId);
      }
      // every valid message is a TICK for this vehicle's pending pairs (ADR 0005)
      const ts = Date.parse(t.ts);
      for (const geofenceId of [...(pending.get(t.vehicleId) ?? [])]) {
        track(await handleCoreEvent({ kind: 'TICK', vehicleId: t.vehicleId, geofenceId, deviceTs: ts }, handleDeps), t.vehicleId, geofenceId);
      }
    },
    latest: () => latest,
    stats: () => ({ ...counts, duplicateDeliveries: stub.duplicateDeliveries, outcomes: { ...outcomes } }),
  };
}
