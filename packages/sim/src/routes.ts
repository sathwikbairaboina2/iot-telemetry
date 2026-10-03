import { bearingDeg, haversineM, type LatLon } from './geo.js';

/** A closed loop: the last point connects back to the first. */
export interface Route { id: string; points: LatLon[]; cumulativeM: number[]; lengthM: number }

/** `coords` are GeoJSON `[lon, lat]`. A repeated closing point is dropped. */
export function routeFromCoords(id: string, coords: Array<[number, number]>): Route {
  let pts = coords.map(([lon, lat]): LatLon => ({ lat, lon }));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 2 && first && last && first.lat === last.lat && first.lon === last.lon) pts = pts.slice(0, -1);
  if (pts.length < 3) throw new Error('a route needs at least 3 points');
  const cumulativeM: number[] = [0];
  for (let i = 1; i < pts.length; i++) cumulativeM.push(cumulativeM[i - 1]! + haversineM(pts[i - 1]!, pts[i]!));
  const lengthM = cumulativeM[pts.length - 1]! + haversineM(pts[pts.length - 1]!, pts[0]!);
  return { id, points: pts, cumulativeM, lengthM };
}

export function loadRoutes(geojson: unknown): Route[] {
  const fc = geojson as { features?: Array<{ properties?: { id?: string }; geometry?: { type: string; coordinates: Array<[number, number]> } }> };
  const out: Route[] = [];
  (fc.features ?? []).forEach((f, i) => {
    if (f.geometry?.type !== 'LineString') return;
    out.push(routeFromCoords(f.properties?.id ?? `route-${i}`, f.geometry.coordinates));
  });
  return out;
}

/** Position and heading after `distanceM` along the loop (wraps modulo the length). */
export function positionAt(route: Route, distanceM: number): LatLon & { headingDeg: number } {
  const n = route.points.length;
  const d = ((distanceM % route.lengthM) + route.lengthM) % route.lengthM;
  let i = 0;
  while (i < n - 1 && route.cumulativeM[i + 1]! <= d) i++;
  const a = route.points[i]!;
  const b = route.points[(i + 1) % n]!;
  const segStart = route.cumulativeM[i]!;
  const segEnd = i + 1 < n ? route.cumulativeM[i + 1]! : route.lengthM;
  const f = segEnd > segStart ? (d - segStart) / (segEnd - segStart) : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    headingDeg: bearingDeg(a, b),
  };
}
