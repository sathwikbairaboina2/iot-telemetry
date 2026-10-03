import { connectAsync, type MqttClient } from 'mqtt';
import { statusTopic, telemetryTopic, type Telemetry } from '@iot-telemetry/schema';
import type { TelemetrySink } from './fleet.js';

export interface MqttFleetSinkOptions {
  url: string;
  qos?: 0 | 1;
  /** Called right before each publish with the wall-clock time in ms (sub-millisecond precision). */
  onPublish?: (t: Telemetry, atMs: number) => void;
}

const status = (state: 'online' | 'offline') => JSON.stringify({ state, ts: new Date().toISOString() });

/** One MQTT client per vehicle, like a real fleet: its own client id, Last Will and connection. */
export class MqttFleetSink implements TelemetrySink {
  private readonly clients = new Map<string, Promise<MqttClient>>();
  private readonly qos: 0 | 1;

  constructor(private readonly opts: MqttFleetSinkOptions) {
    this.qos = opts.qos ?? 1;
  }

  private client(vehicleId: string): Promise<MqttClient> {
    let c = this.clients.get(vehicleId);
    if (!c) {
      c = connectAsync(this.opts.url, {
        clientId: vehicleId,
        reconnectPeriod: 0,
        will: { topic: statusTopic(vehicleId), payload: Buffer.from(status('offline')), qos: 1, retain: true },
      });
      this.clients.set(vehicleId, c);
    }
    return c;
  }

  async publish(t: Telemetry): Promise<void> {
    const c = await this.client(t.vehicleId);
    this.opts.onPublish?.(t, performance.timeOrigin + performance.now());
    await c.publishAsync(telemetryTopic(t.vehicleId), JSON.stringify(t), { qos: this.qos });
  }

  async setOnline(vehicleId: string, online: boolean): Promise<void> {
    if (!online) {
      const pending = this.clients.get(vehicleId);
      if (!pending) return;
      const c = await pending;
      this.clients.delete(vehicleId);
      // an ungraceful drop: the broker publishes the Last Will
      c.stream.destroy();
      await c.endAsync(true);
      return;
    }
    const c = await this.client(vehicleId);
    await c.publishAsync(statusTopic(vehicleId), status('online'), { qos: 1, retain: true });
  }

  async close(): Promise<void> {
    const all = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(all.map(async (p) => {
      const c = await p;
      const id = c.options.clientId;
      if (id) await c.publishAsync(statusTopic(id), status('offline'), { qos: 1, retain: true });
      await c.endAsync();
    }));
  }
}
