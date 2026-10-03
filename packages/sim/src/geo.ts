export interface LatLon { lat: number; lon: number }

const R = 6_371_000;
const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b in [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  const d = deg(Math.atan2(y, x));
  return ((d % 360) + 360) % 360;
}

/** Flat-earth offset, accurate to well under a metre for the distances used here. */
export function offsetM(p: LatLon, northM: number, eastM: number): LatLon {
  return {
    lat: p.lat + deg(northM / R),
    lon: p.lon + deg(eastM / (R * Math.cos(rad(p.lat)))),
  };
}
