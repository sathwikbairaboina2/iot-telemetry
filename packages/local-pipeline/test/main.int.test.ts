import { describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectAsync } from 'mqtt';
import type { Alert } from '@iot-telemetry/alert-core';
import { telemetryTopic, type Telemetry } from '@iot-telemetry/schema';
import { MemorySeq, VirtualClock, depotBounds, runFleet } from '@iot-telemetry/sim';
import { startPipeline } from '../src/main.js';

const MQTT = process.env.IOT_IT_MQTT_URL;
const WS = process.env.IOT_IT_MQTT_WS_URL;
const geofenceFile = fileURLToPath(new URL('../../../data/geofences/depot-north.geojson', import.meta.url));

describe.skipIf(!MQTT || !WS)('startPipeline against a broker', () => {
  test('loiter session over MQTT yields one ENTERED and one EXITED, and geofences are retained', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'pipe-'));
    const pipeline = await startPipeline({ mqttUrl: MQTT!, geofenceFile, dataDir, duplicateRate: 0.2, seed: 42 });

    const sub = await connectAsync(WS!, { reconnectPeriod: 0 });
    const alerts: Alert[] = [];
    let geofences: { features: unknown[] } | undefined;
    sub.on('message', (topic, payload) => {
      if (topic === 'fleet/alerts') alerts.push(JSON.parse(payload.toString()) as Alert);
      if (topic === 'fleet/geofences') geofences = JSON.parse(payload.toString());
    });
    await sub.subscribeAsync(['fleet/alerts', 'fleet/geofences'], { qos: 1 });

    const messages: Telemetry[] = [];
    await runFleet({
      count: 0, hz: 1, durationMs: 400_000, seed: 42, routes: [], scenarios: ['loiter'],
      depot: depotBounds(JSON.parse(readFileSync(geofenceFile, 'utf8'))), clock: new VirtualClock(Date.UTC(2026, 9, 4, 8)),
      seq: new MemorySeq(), sink: { async publish(t) { messages.push(t); }, async setOnline() {} },
    });
    const pub = await connectAsync(MQTT!, { reconnectPeriod: 0 });
    for (const t of messages) await pub.publishAsync(telemetryTopic(t.vehicleId), JSON.stringify(t), { qos: 1 });

    const deadline = Date.now() + 10_000;
    while (alerts.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect(alerts.filter((a) => a.vehicleId === 'veh-9001').map((a) => a.type)).toEqual(['ENTERED', 'EXITED']);
    expect(geofences?.features).toHaveLength(1);

    await pub.endAsync();
    await sub.endAsync();
    await pipeline.stop();
  }, 60_000);
});
