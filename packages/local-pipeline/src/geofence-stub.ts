import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, polygon as turfPolygon } from '@turf/helpers';
import type { Telemetry } from '@iot-telemetry/schema';
import type { LocationGeofenceEvent } from '@iot-telemetry/alert-lambda';
import { mulberry32 } from '@iot-telemetry/sim';

export interface Geofence { id: string; name: string; polygon: { type: 'Polygon'; coordinates: number[][][] } }

export function loadGeofences(geojson: unknown): Geofence[] {
  const fc = geojson as { features?: Array<{ properties?: { id?: string; name?: string }; geometry?: { type: string; coordinates: number[][][] } }> };
  const out: Geofence[] = [];
  for (const f of fc.features ?? []) {
    if (f.geometry?.type !== 'Polygon' || !f.properties?.id) continue;
    out.push({ id: f.properties.id, name: f.properties.name ?? f.properties.id, polygon: { type: 'Polygon', coordinates: f.geometry.coordinates } });
  }
  return out;
}

/**
 * Local stand-in for Amazon Location geofencing: remembers inside/outside per (vehicle, geofence) and emits an event
 * on every change, in the shape of the EventBridge "Location Geofence Event". A first position inside emits ENTER, as
 * Location does. `duplicateRate` re-delivers an event with that probability (EventBridge is at-least-once).
 */
export class GeofenceStub {
  private readonly inside = new Map<string, boolean>();
  private readonly rng: () => number;
  private duplicates = 0;

  constructor(private readonly geofences: Geofence[], private readonly opts: { duplicateRate?: number; seed?: number } = {}) {
    this.rng = mulberry32(opts.seed ?? 1);
  }

  get duplicateDeliveries(): number { return this.duplicates; }

  evaluate(t: Telemetry): LocationGeofenceEvent[] {
    const out: LocationGeofenceEvent[] = [];
    const pt = point([t.lon, t.lat]);
    for (const g of this.geofences) {
      const now = booleanPointInPolygon(pt, turfPolygon(g.polygon.coordinates));
      const key = `${t.vehicleId}\u0000${g.id}`;
      const before = this.inside.get(key) ?? false;
      this.inside.set(key, now);
      if (now === before) continue;
      const ev = this.event(t, g, now ? 'ENTER' : 'EXIT');
      out.push(ev);
      if ((this.opts.duplicateRate ?? 0) > 0 && this.rng() < this.opts.duplicateRate!) {
        out.push(structuredClone(ev));
        this.duplicates++;
      }
    }
    return out;
  }

  private event(t: Telemetry, g: Geofence, type: 'ENTER' | 'EXIT'): LocationGeofenceEvent {
    return {
      version: '0',
      id: `loc-${t.vehicleId}-${g.id}-${t.seq}-${type}`,
      'detail-type': 'Location Geofence Event',
      source: 'aws.geo',
      account: '000000000000',
      time: t.ts,
      region: 'local',
      resources: [
        'arn:aws:geo:local:000000000000:geofence-collection/fleet-geofences',
        'arn:aws:geo:local:000000000000:tracker/fleet',
      ],
      detail: {
        EventType: type, GeofenceId: g.id, DeviceId: t.vehicleId, SampleTime: t.ts,
        Position: [t.lon, t.lat], GeofenceProperties: { name: g.name },
      },
    };
  }
}
