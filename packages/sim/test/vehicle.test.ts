import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateTelemetry } from '@iot-telemetry/schema';
import { haversineM, loadRoutes, mulberry32, routeVehicle, scriptedVehicle, toTelemetry } from '../src/index.js';

const routes = loadRoutes(JSON.parse(readFileSync(fileURLToPath(new URL('../../../data/routes/munich.geojson', import.meta.url)), 'utf8')));
const start = Date.UTC(2026, 9, 4, 8);
const make = (seed: number, jitterM?: number) =>
  routeVehicle({ id: 'veh-0001', route: routes[3]!, rng: mulberry32(seed), startMs: start, startOffsetM: 500, baseSpeedKph: 50, jitterM });

describe('routeVehicle', () => {
  test('2000 samples over 2 h are schema-valid and the odometer never decreases', () => {
    const v = make(1);
    let last = -1;
    for (let i = 0; i < 2000; i++) {
      const s = v.sample(start + i * 3600);
      const t = toTelemetry(v.id, i, start + i * 3600, s);
      const r = validateTelemetry(t);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(t.odometerKm).toBeGreaterThanOrEqual(last);
      last = t.odometerKm;
    }
  });
  test('without jitter, 1 s samples at 50 km/h are 10-20 m apart', () => {
    const v = make(2, 0);
    let prev = v.sample(start);
    for (let i = 1; i < 120; i++) {
      const s = v.sample(start + i * 1000);
      const d = haversineM(prev, s);
      expect(d).toBeGreaterThan(10);
      expect(d).toBeLessThan(20);
      prev = s;
    }
  });
  test('same seed gives identical samples', () => {
    const a = make(9);
    const b = make(9);
    for (let i = 0; i < 100; i++) expect(a.sample(start + i * 1000)).toEqual(b.sample(start + i * 1000));
  });
});

describe('scriptedVehicle', () => {
  const v = scriptedVehicle({
    id: 'veh-9001', startMs: start,
    waypoints: [{ atMs: 0, lat: 48.0, lon: 11.5 }, { atMs: 100_000, lat: 48.001, lon: 11.5 }],
  });
  test('interpolates linearly and holds the last point', () => {
    expect(v.sample(start + 50_000).lat).toBeCloseTo(48.0005, 9);
    expect(v.sample(start + 500_000).lat).toBeCloseTo(48.001, 9);
    expect(v.sample(start - 5000).lat).toBeCloseTo(48.0, 9);
  });
  test('output is schema-valid', () => {
    expect(validateTelemetry(toTelemetry(v.id, 0, start, v.sample(start))).ok).toBe(true);
  });
});
