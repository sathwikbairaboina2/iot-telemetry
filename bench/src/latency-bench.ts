import { connectAsync } from 'mqtt';
import { MemorySeq, MqttFleetSink, RealClock, depotBounds, loadRoutes, runFleet } from '@iot-telemetry/sim';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { summarize } from './stats.js';

export interface LatencyBenchResult {
  vehicles: number; hz: number; durationS: number; sent: number; received: number; latencyMs: ReturnType<typeof summarize>;
}

const now = (): number => performance.timeOrigin + performance.now();
const root = (rel: string): string => fileURLToPath(new URL(`../../${rel}`, import.meta.url));

/**
 * Publish-to-subscriber latency through the broker over MQTT-over-WebSockets (the browser path). Publisher and
 * subscriber live in one process and read the same clock, so no clock-skew correction is needed.
 */
export async function runLatencyBench(opts: { mqttUrl: string; wsUrl: string; vehicles: number; hz: number; durationS: number }): Promise<LatencyBenchResult> {
  const sentAt = new Map<string, number>();
  const latencies: number[] = [];

  const sub = await connectAsync(opts.wsUrl, { reconnectPeriod: 0 });
  sub.on('message', (_topic, payload) => {
    const t1 = now();
    const m = JSON.parse(payload.toString()) as { vehicleId: string; seq: number };
    const t0 = sentAt.get(`${m.vehicleId}:${m.seq}`);
    if (t0 !== undefined) latencies.push(t1 - t0);
  });
  await sub.subscribeAsync('fleet/+/telemetry', { qos: 1 });

  const sink = new MqttFleetSink({ url: opts.mqttUrl, onPublish: (t, atMs) => { sentAt.set(`${t.vehicleId}:${t.seq}`, atMs); } });
  const routes = loadRoutes(JSON.parse(readFileSync(root('data/routes/munich.geojson'), 'utf8')));
  const depot = depotBounds(JSON.parse(readFileSync(root('data/geofences/depot-north.geojson'), 'utf8')));
  await runFleet({
    count: opts.vehicles, hz: opts.hz, durationMs: opts.durationS * 1000, seed: 42, routes, scenarios: [], depot,
    clock: new RealClock(), sink, seq: new MemorySeq(),
  });
  await new Promise((r) => setTimeout(r, 3000));
  await sink.close();
  await sub.endAsync();

  return {
    vehicles: opts.vehicles, hz: opts.hz, durationS: opts.durationS,
    sent: sentAt.size, received: latencies.length, latencyMs: summarize(latencies),
  };
}
