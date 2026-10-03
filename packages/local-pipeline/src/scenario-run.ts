import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, type Alert } from '@iot-telemetry/alert-core';
import { CollectingPublisher, MemoryAlertStateRepo } from '@iot-telemetry/alert-lambda';
import { telemetryTopic, type Telemetry } from '@iot-telemetry/schema';
import { MemorySeq, VirtualClock, depotBounds, runFleet, type FleetRunStats, type ScenarioName } from '@iot-telemetry/sim';
import { loadGeofences } from './geofence-stub.js';
import { createPipeline, type PipelineStats } from './pipeline.js';
import { MemorySink, type QuarantineRecord } from './sinks.js';

export interface ScenarioRunResult { alerts: Alert[]; stats: PipelineStats; history: Telemetry[]; fleet: FleetRunStats }

const DEFAULT_GEOFENCE = fileURLToPath(new URL('../../../data/geofences/depot-north.geojson', import.meta.url));

/** Runs the scenario vehicles on a virtual clock and feeds every published message, in order, through the pipeline. */
export async function simulateScenarios(opts: {
  scenarios: ScenarioName[]; outages?: boolean; duplicateRate?: number; seed?: number; durationS?: number; geofenceFile?: string;
}): Promise<ScenarioRunResult> {
  const geojson: unknown = JSON.parse(readFileSync(opts.geofenceFile ?? DEFAULT_GEOFENCE, 'utf8'));
  const messages: Telemetry[] = [];
  const fleet = await runFleet({
    count: 0, hz: 1, durationMs: (opts.durationS ?? 400) * 1000, seed: opts.seed ?? 42, routes: [], scenarios: opts.scenarios,
    depot: depotBounds(geojson), clock: new VirtualClock(Date.UTC(2026, 9, 4, 8)), seq: new MemorySeq(), outages: opts.outages,
    sink: { async publish(t) { messages.push(t); }, async setOnline() {} },
  });
  const publisher = new CollectingPublisher();
  const history = new MemorySink<Telemetry>();
  const pipeline = createPipeline({
    repo: new MemoryAlertStateRepo(), publisher, config: DEFAULT_CONFIG, geofences: loadGeofences(geojson),
    history, quarantine: new MemorySink<QuarantineRecord>(), duplicateRate: opts.duplicateRate, seed: opts.seed ?? 42,
    receivedAt: () => '2026-10-04T08:00:00.000Z',
  });
  for (const t of messages) await pipeline.handle(telemetryTopic(t.vehicleId), JSON.stringify(t));
  return { alerts: publisher.published, stats: pipeline.stats(), history: history.records, fleet };
}
