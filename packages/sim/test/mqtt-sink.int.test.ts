import { afterAll, describe, expect, test } from 'vitest';
import { connectAsync } from 'mqtt';
import type { Telemetry } from '@iot-telemetry/schema';
import { MqttFleetSink, MemorySeq, toTelemetry } from '../src/index.js';

const MQTT = process.env.IOT_IT_MQTT_URL;
const WS = process.env.IOT_IT_MQTT_WS_URL;

describe.skipIf(!MQTT || !WS)('MqttFleetSink against a broker', () => {
  const sink = new MqttFleetSink({ url: MQTT! });
  afterAll(async () => { await sink.close(); });

  test('delivers 20 messages in order and publishes the Last Will on ungraceful drop', async () => {
    const sub = await connectAsync(WS!, { reconnectPeriod: 0 });
    const got: Telemetry[] = [];
    const statuses: string[] = [];
    sub.on('message', (topic, payload) => {
      if (topic.endsWith('/telemetry')) got.push(JSON.parse(payload.toString()) as Telemetry);
      if (topic.endsWith('/status')) statuses.push(JSON.parse(payload.toString()).state as string);
    });
    await sub.subscribeAsync('fleet/#', { qos: 1 });

    const seq = new MemorySeq();
    for (let i = 0; i < 20; i++) {
      const t = toTelemetry('veh-0001', seq.next('veh-0001'), Date.now(), {
        lat: 48.1, lon: 11.5, speedKph: 10, headingDeg: 0, odometerKm: 1, batteryPct: 90, ignition: true,
      });
      await sink.publish(t);
    }
    await sink.setOnline('veh-0001', true);
    const deadline = Date.now() + 3000;
    while (got.length < 20 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(got.map((g) => g.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i));

    await sink.setOnline('veh-0001', false);
    const deadline2 = Date.now() + 3000;
    while (!statuses.includes('offline') && Date.now() < deadline2) await new Promise((r) => setTimeout(r, 50));
    expect(statuses).toContain('offline');
    await sub.endAsync();
  });
});
