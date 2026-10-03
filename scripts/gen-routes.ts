// Generates data/routes/munich.geojson. Deterministic: seed 42, same bytes on every run.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../packages/sim/src/prng.js';
import { offsetM, type LatLon } from '../packages/sim/src/geo.js';

const CENTER: LatLon = { lat: 48.1374, lon: 11.5755 };
const DEPOT = { south: 48.15, north: 48.158, west: 11.56, east: 11.575 };
const DEPOT_CENTER: LatLon = { lat: (DEPOT.south + DEPOT.north) / 2, lon: (DEPOT.west + DEPOT.east) / 2 };
const POINTS = 24;
const LOOPS = 12;

const rng = mulberry32(42);
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const inDepot = (p: LatLon): boolean => p.lat >= DEPOT.south && p.lat <= DEPOT.north && p.lon >= DEPOT.west && p.lon <= DEPOT.east;

const features = [];
for (let k = 0; k < LOOPS; k++) {
  const rx = 600 + rng() * 1400;
  const ry = 600 + rng() * 1400;
  const through = k < 3;
  const vertex = Math.floor(rng() * POINTS);
  let centre: LatLon;
  if (through) {
    // place the centre so that this loop's vertex lands on the middle of the depot
    const th = (2 * Math.PI * vertex) / POINTS;
    centre = offsetM(DEPOT_CENTER, -ry * Math.sin(th), -rx * Math.cos(th));
  } else {
    const ang = rng() * 2 * Math.PI;
    const dist = rng() * 3000;
    centre = offsetM(CENTER, dist * Math.sin(ang), dist * Math.cos(ang));
  }
  const pts: LatLon[] = [];
  for (let i = 0; i < POINTS; i++) {
    const th = (2 * Math.PI * i) / POINTS;
    const factor = through && i === vertex ? 1 : 1 + (rng() * 2 - 1) * 0.15;
    pts.push(offsetM(centre, ry * Math.sin(th) * factor, rx * Math.cos(th) * factor));
  }
  if (through && !pts.some(inDepot)) throw new Error(`loop ${k} does not pass through the depot`);
  const coords = pts.map((p) => [round6(p.lon), round6(p.lat)]);
  coords.push(coords[0]!);
  features.push({
    type: 'Feature',
    properties: { id: `route-${String(k).padStart(2, '0')}` },
    geometry: { type: 'LineString', coordinates: coords },
  });
}

const out = fileURLToPath(new URL('../data/routes/munich.geojson', import.meta.url));
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }, null, 1) + '\n');
console.log(`wrote ${features.length} routes to ${out}`);
