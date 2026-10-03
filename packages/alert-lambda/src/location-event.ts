import type { GeofenceEvent } from '@iot-telemetry/alert-core';

/** Shape copied from the AWS docs example for the "Location Geofence Event" EventBridge event. */
export interface LocationGeofenceEvent {
  version: '0';
  id: string;
  'detail-type': 'Location Geofence Event';
  source: 'aws.geo';
  account: string;
  time: string;
  region: string;
  resources: string[];
  detail: {
    EventType: 'ENTER' | 'EXIT';
    GeofenceId: string;
    DeviceId: string;
    SampleTime: string;
    Position: [number, number];
    Accuracy?: { Horizontal: number };
    GeofenceProperties?: Record<string, string>;
    PositionProperties?: Record<string, string>;
  };
}

export function isLocationGeofenceEvent(x: unknown): x is LocationGeofenceEvent {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  if (e['detail-type'] !== 'Location Geofence Event' || e.source !== 'aws.geo' || typeof e.id !== 'string') return false;
  const d = e.detail as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') return false;
  return (d.EventType === 'ENTER' || d.EventType === 'EXIT')
    && typeof d.GeofenceId === 'string'
    && typeof d.DeviceId === 'string'
    && typeof d.SampleTime === 'string'
    && Array.isArray(d.Position) && d.Position.length === 2;
}

export function toCoreEvent(e: LocationGeofenceEvent): GeofenceEvent {
  const deviceTs = Date.parse(e.detail.SampleTime);
  if (Number.isNaN(deviceTs)) throw new Error(`bad SampleTime: ${e.detail.SampleTime}`);
  return { kind: e.detail.EventType, eventId: e.id, vehicleId: e.detail.DeviceId, geofenceId: e.detail.GeofenceId, deviceTs };
}
