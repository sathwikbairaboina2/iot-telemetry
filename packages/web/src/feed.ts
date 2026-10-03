import { connect } from 'mqtt';
import type { Alert } from '@iot-telemetry/alert-core';
import type { Telemetry } from '@iot-telemetry/schema';
import type { FleetAction, GeoFeatureCollection } from './state.js';

export type ConnState = 'connecting' | 'live' | 'offline';

export const DEFAULT_MQTT_URL: string = import.meta.env?.VITE_MQTT_URL ?? 'ws://localhost:5371';

/** `?mqtt=ws://...` overrides the broker URL (the e2e container uses it). */
export function mqttUrlFromLocation(search: string, fallback: string): string {
  return new URLSearchParams(search).get('mqtt') || fallback;
}

const isTelemetry = (x: unknown): x is Telemetry => {
  const t = x as Partial<Telemetry> | null;
  return !!t && typeof t.vehicleId === 'string' && typeof t.seq === 'number' && typeof t.lat === 'number' && typeof t.lon === 'number';
};

function parse(payload: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder().decode(payload)); } catch { return undefined; }
}

/** Subscribes to the four topics and turns messages into reducer actions. Returns a disposer. */
export function connectFeed(url: string, dispatch: (a: FleetAction) => void, onConn: (s: ConnState) => void = () => {}): () => void {
  onConn('connecting');
  const client = connect(url, { reconnectPeriod: 2000 });
  client.on('connect', () => {
    onConn('live');
    client.subscribe(['fleet/+/telemetry', 'fleet/+/status', 'fleet/alerts', 'fleet/geofences'], { qos: 1 });
  });
  client.on('close', () => onConn('offline'));
  client.on('reconnect', () => onConn('connecting'));
  client.on('message', (topic, payload) => {
    const data = parse(payload);
    if (data === undefined) return;
    if (topic === 'fleet/alerts') {
      dispatch({ type: 'alert', alert: data as Alert });
    } else if (topic === 'fleet/geofences') {
      dispatch({ type: 'geofences', geojson: data as GeoFeatureCollection });
    } else if (topic.endsWith('/telemetry')) {
      if (isTelemetry(data)) dispatch({ type: 'telemetry', telemetry: data, receivedMs: Date.now() });
    } else if (topic.endsWith('/status')) {
      const id = topic.split('/')[1];
      const state = (data as { state?: unknown }).state;
      if (id && (state === 'online' || state === 'offline')) dispatch({ type: 'status', vehicleId: id, online: state === 'online' });
    }
  });
  return () => { client.end(); };
}
