import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bearingDeg, haversineM, loadRoutes, positionAt, routeFromCoords } from '../src/index.js';

const square: Array<[number, number]> = [[11.5, 48.1], [11.51, 48.1], [11.51, 48.11], [11.5, 48.11]];

test('closed route length is the sum of all edges including the closing one', () => {
  const r = routeFromCoords('sq', square);
  const pts = r.points;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) sum += haversineM(pts[i]!, pts[(i + 1) % pts.length]!);
  expect(r.lengthM).toBeCloseTo(sum, 6);
});
test('positionAt wraps and starts at the first point', () => {
  const r = routeFromCoords('sq', square);
  const p0 = positionAt(r, 0);
  expect(p0.lat).toBeCloseTo(48.1, 9);
  expect(p0.lon).toBeCloseTo(11.5, 9);
  const a = positionAt(r, r.lengthM + 10);
  const b = positionAt(r, 10);
  expect(a.lat).toBeCloseTo(b.lat, 8);
  expect(a.lon).toBeCloseTo(b.lon, 8);
  expect(p0.headingDeg).toBeCloseTo(bearingDeg(r.points[0]!, r.points[1]!), 6);
});
test('the committed Munich routes load', () => {
  const file = fileURLToPath(new URL('../../../data/routes/munich.geojson', import.meta.url));
  const routes = loadRoutes(JSON.parse(readFileSync(file, 'utf8')));
  expect(routes).toHaveLength(12);
  for (const r of routes) expect(r.lengthM).toBeGreaterThan(2000);
});
