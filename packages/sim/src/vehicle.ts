import type { Telemetry } from '@iot-telemetry/schema';
import { bearingDeg, haversineM, offsetM, type LatLon } from './geo.js';
import { gaussian, type Rng } from './prng.js';
import { positionAt, type Route } from './routes.js';

export interface VehicleSample {
  lat: number; lon: number; speedKph: number; headingDeg: number; odometerKm: number; batteryPct: number; ignition: boolean;
}
export interface VehicleModel { readonly id: string; sample(nowMs: number): VehicleSample }

export function routeVehicle(opts: {
  id: string; route: Route; rng: Rng; startMs: number; startOffsetM: number; baseSpeedKph: number; jitterM?: number;
}): VehicleModel {
  const { id, route, rng, startMs, startOffsetM, baseSpeedKph } = opts;
  const jitterM = opts.jitterM ?? 3;
  const odometerStart = 1000 + rng() * 20000;
  const batteryStart = 60 + rng() * 40;
  let lastMs = startMs;
  let distM = 0;
  return {
    id,
    sample(nowMs: number): VehicleSample {
      const t = (nowMs - startMs) / 1000;
      const speedKph = Math.min(130, Math.max(0, baseSpeedKph * (1 + 0.2 * Math.sin((2 * Math.PI * t) / 300))));
      const dt = Math.max(0, (nowMs - lastMs) / 1000);
      distM += (speedKph / 3.6) * dt;
      lastMs = Math.max(lastMs, nowMs);
      const pos = positionAt(route, startOffsetM + distM);
      const p = jitterM > 0 ? offsetM(pos, gaussian(rng) * jitterM, gaussian(rng) * jitterM) : pos;
      const km = distM / 1000;
      return {
        lat: p.lat, lon: p.lon, speedKph, headingDeg: pos.headingDeg,
        odometerKm: odometerStart + km,
        batteryPct: Math.max(5, batteryStart - 0.15 * km),
        ignition: true,
      };
    },
  };
}

/** Linear interpolation between waypoints (times relative to `startMs`); holds the first and last point. No jitter. */
export function scriptedVehicle(opts: { id: string; startMs: number; waypoints: Array<{ atMs: number } & LatLon> }): VehicleModel {
  const { id, startMs, waypoints } = opts;
  if (waypoints.length === 0) throw new Error('scriptedVehicle needs waypoints');
  // cumulative distance at each waypoint, for the odometer
  const cum: number[] = [0];
  for (let i = 1; i < waypoints.length; i++) cum.push(cum[i - 1]! + haversineM(waypoints[i - 1]!, waypoints[i]!));
  let heading = 0;
  return {
    id,
    sample(nowMs: number): VehicleSample {
      const t = nowMs - startMs;
      const first = waypoints[0]!;
      const last = waypoints[waypoints.length - 1]!;
      let lat = first.lat;
      let lon = first.lon;
      let speedKph = 0;
      let dist = 0;
      if (t >= last.atMs) {
        lat = last.lat; lon = last.lon; dist = cum[cum.length - 1]!;
      } else if (t > first.atMs) {
        let i = 0;
        while (i < waypoints.length - 2 && waypoints[i + 1]!.atMs <= t) i++;
        const a = waypoints[i]!;
        const b = waypoints[i + 1]!;
        const span = b.atMs - a.atMs;
        const f = span > 0 ? (t - a.atMs) / span : 1;
        lat = a.lat + (b.lat - a.lat) * f;
        lon = a.lon + (b.lon - a.lon) * f;
        const segM = haversineM(a, b);
        dist = cum[i]! + segM * f;
        speedKph = span > 0 ? Math.min(130, (segM / (span / 1000)) * 3.6) : 0;
        if (segM > 0) heading = bearingDeg(a, b);
      }
      return { lat, lon, speedKph, headingDeg: heading, odometerKm: 5000 + dist / 1000, batteryPct: 80, ignition: true };
    },
  };
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export function toTelemetry(id: string, seq: number, nowMs: number, s: VehicleSample): Telemetry {
  let heading = r1(s.headingDeg);
  if (heading >= 360) heading = 0;
  return {
    v: 1, vehicleId: id, seq, ts: new Date(nowMs).toISOString(),
    lat: r6(s.lat), lon: r6(s.lon), speedKph: r1(s.speedKph), headingDeg: heading,
    odometerKm: r1(s.odometerKm), batteryPct: r1(s.batteryPct), ignition: s.ignition,
  };
}
