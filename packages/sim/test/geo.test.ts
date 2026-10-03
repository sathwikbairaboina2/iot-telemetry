import { expect, test } from 'vitest';
import { bearingDeg, haversineM, offsetM } from '../src/index.js';

const p = { lat: 48.1374, lon: 11.5755 };

test('haversine 0.01 degrees of latitude is about 1112 m', () => {
  expect(Math.abs(haversineM(p, { lat: 48.1474, lon: 11.5755 }) - 1112)).toBeLessThan(1);
});
test('bearing', () => {
  expect(bearingDeg(p, { lat: 48.2, lon: 11.5755 })).toBeCloseTo(0, 6);
  expect(Math.abs(bearingDeg(p, { lat: 48.1374, lon: 11.6 }) - 90)).toBeLessThan(0.1);
  const b = bearingDeg(p, { lat: 48.0, lon: 11.5755 });
  expect(b).toBeGreaterThanOrEqual(0);
  expect(b).toBeLessThan(360);
});
test('offsetM moves the requested distance', () => {
  expect(Math.abs(haversineM(p, offsetM(p, 1000, 0)) - 1000)).toBeLessThan(1);
  expect(Math.abs(haversineM(p, offsetM(p, 0, 1000)) - 1000)).toBeLessThan(1);
});
