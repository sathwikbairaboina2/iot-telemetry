import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isLocationGeofenceEvent, toCoreEvent } from '../src/index.js';

const fixture = (n: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), 'utf8'));

test('AWS docs ENTER example maps to a core event', () => {
  const e = fixture('location-enter.json');
  expect(isLocationGeofenceEvent(e)).toBe(true);
  expect(toCoreEvent(e)).toEqual({
    kind: 'ENTER', eventId: 'aa11aa22-33a-4a4a-aaa5-example', vehicleId: 'Device1-EXAMPLE', geofenceId: 'polygon_14',
    deviceTs: Date.parse('2020-11-10T23:43:37.531Z'),
  });
});
test('EXIT maps to kind EXIT', () => {
  expect(toCoreEvent(fixture('location-exit.json')).kind).toBe('EXIT');
});
test('other events and junk are rejected', () => {
  expect(isLocationGeofenceEvent({ ...fixture('location-enter.json'), 'detail-type': 'Location Device Position Event' })).toBe(false);
  expect(isLocationGeofenceEvent({})).toBe(false);
  expect(isLocationGeofenceEvent(null)).toBe(false);
});
test('a bad SampleTime throws', () => {
  const e = fixture('location-enter.json');
  e.detail.SampleTime = 'yesterday-ish';
  expect(() => toCoreEvent(e)).toThrow();
});
