import { scriptedVehicle, type VehicleModel } from './vehicle.js';
import type { Depot } from './fleet.js';

export const LOITER_ID = 'veh-9001';
export const TUNNEL_ID = 'veh-9002';
/** Outage window of the tunnel vehicle, relative to the run start. */
export const TUNNEL_OFFLINE = { fromMs: 30_000, toMs: 120_000 };

const D = 0.0003; // about 33 m of latitude

/**
 * Hovers across the south edge of the depot for a minute (every crossing is a raw ENTER or EXIT), then parks inside
 * long enough to confirm, then leaves. The alert core must produce one ENTERED and one EXITED.
 */
export function loiterVehicle(startMs: number, depot: Depot): VehicleModel {
  const lon = (depot.west + depot.east) / 2;
  const s = depot.south;
  const at = (sec: number, lat: number) => ({ atMs: sec * 1000, lat, lon });
  const waypoints = [at(0, s - 0.001), at(20, s - D)];
  for (let sec = 25, inside = true; sec <= 80; sec += 5, inside = !inside) waypoints.push(at(sec, inside ? s + D : s - D));
  waypoints.push(at(85, s + 0.002), at(205, s + 0.002), at(235, s - 0.01));
  return scriptedVehicle({ id: LOITER_ID, startMs, waypoints });
}

/** Drives into the depot during its radio outage (30 s to 120 s) and out again after it. */
export function tunnelVehicle(startMs: number, depot: Depot): VehicleModel {
  const lon = (depot.west + depot.east) / 2;
  const at = (sec: number, lat: number) => ({ atMs: sec * 1000, lat, lon });
  return scriptedVehicle({
    id: TUNNEL_ID, startMs,
    waypoints: [at(0, depot.south - 0.005), at(60, depot.south + 0.003), at(150, depot.south + 0.003), at(200, depot.north + 0.005)],
  });
}

/** Bounding box of the first polygon of a GeoJSON FeatureCollection. */
export function depotBounds(geofenceGeoJson: unknown): Depot {
  const fc = geofenceGeoJson as { features: Array<{ geometry: { coordinates: number[][][] } }> };
  const ring = fc.features[0]?.geometry.coordinates[0];
  if (!ring) throw new Error('no polygon in geofence file');
  const lons = ring.map((p) => p[0]!);
  const lats = ring.map((p) => p[1]!);
  return { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) };
}
