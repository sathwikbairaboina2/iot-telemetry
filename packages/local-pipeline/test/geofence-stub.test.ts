import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Telemetry } from '@iot-telemetry/schema';
import { isLocationGeofenceEvent } from '@iot-telemetry/alert-lambda';
import { GeofenceStub, loadGeofences } from '../src/index.js';

const geofences = loadGeofences(JSON.parse(readFileSync(fileURLToPath(new URL('../../../data/geofences/depot-north.geojson', import.meta.url)), 'utf8')));
const t = (id: string, seq: number, lat: number, lon = 11.5675): Telemetry => ({
  v: 1, vehicleId: id, seq, ts: new Date(Date.UTC(2026, 9, 4, 8, 0, seq)).toISOString(), lat, lon,
  speedKph: 10, headingDeg: 0, odometerKm: 1, batteryPct: 90, ignition: true,
});
const OUT = 48.1;
const IN = 48.154;

describe('GeofenceStub', () => {
  test('outside, inside, inside, outside gives exactly ENTER then EXIT', () => {
    const stub = new GeofenceStub(geofences);
    const events = [t('veh-0001', 0, OUT), t('veh-0001', 1, IN), t('veh-0001', 2, IN), t('veh-0001', 3, OUT)].flatMap((x) => stub.evaluate(x));
    expect(events.map((e) => e.detail.EventType)).toEqual(['ENTER', 'EXIT']);
    expect(events[0]!.id).toBe('loc-veh-0001-depot-north-1-ENTER');
    expect(events[0]!.detail.Position).toEqual([11.5675, IN]);
    expect(events[0]!.detail.GeofenceProperties).toEqual({ name: 'Depot North' });
    for (const e of events) expect(isLocationGeofenceEvent(e)).toBe(true);
  });
  test('vehicles are tracked independently', () => {
    const stub = new GeofenceStub(geofences);
    expect(stub.evaluate(t('veh-0001', 0, IN))).toHaveLength(1);
    expect(stub.evaluate(t('veh-0002', 0, IN))).toHaveLength(1);
    expect(stub.evaluate(t('veh-0001', 1, IN))).toHaveLength(0);
  });
  test('duplicateRate 1 doubles every event and counts them', () => {
    const stub = new GeofenceStub(geofences, { duplicateRate: 1 });
    const events = [t('veh-0001', 0, IN), t('veh-0001', 1, OUT)].flatMap((x) => stub.evaluate(x));
    expect(events).toHaveLength(4);
    expect(events[0]).toEqual(events[1]);
    expect(stub.duplicateDeliveries).toBe(2);
  });
  test('the same seed gives the same duplicates', () => {
    const run = (seed: number) => {
      const stub = new GeofenceStub(geofences, { duplicateRate: 0.5, seed });
      let n = 0;
      for (let i = 0; i < 40; i++) n += stub.evaluate(t('veh-0001', i, i % 2 === 0 ? IN : OUT)).length;
      return [n, stub.duplicateDeliveries];
    };
    expect(run(7)).toEqual(run(7));
  });
});
