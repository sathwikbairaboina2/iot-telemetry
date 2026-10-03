import { describe, expect, test } from 'vitest';
import type { Alert } from '@iot-telemetry/alert-core';
import type { Telemetry } from '@iot-telemetry/schema';
import { MAX_ALERTS, TRAIL_POINTS, fleetReducer, initialFleetState, type FleetAction, type FleetState } from '../src/state.js';
import { mqttUrlFromLocation } from '../src/feed.js';

const tel = (seq: number, lat = 48.1, lon = 11.5, id = 'veh-0001'): Telemetry => ({
  v: 1, vehicleId: id, seq, ts: '2026-10-04T08:00:00.000Z', lat, lon, speedKph: 10, headingDeg: 0, odometerKm: 1, batteryPct: 90, ignition: true,
});
const alert = (n: number): Alert => ({ alertId: `a${n}`, type: 'ENTERED', vehicleId: 'veh-0001', geofenceId: 'g', confirmedAt: n, triggerEventId: null });
const apply = (s: FleetState, ...actions: FleetAction[]) => actions.reduce(fleetReducer, s);
const t = (telemetry: Telemetry): FleetAction => ({ type: 'telemetry', telemetry, receivedMs: 1000 });

describe('fleetReducer', () => {
  test('telemetry adds a vehicle', () => {
    const s = apply(initialFleetState, t(tel(1)));
    expect(Object.keys(s.vehicles)).toEqual(['veh-0001']);
    expect(s.vehicles['veh-0001']).toMatchObject({ online: true, lastSeenMs: 1000, trail: [[11.5, 48.1]] });
    expect(s.messages).toBe(1);
  });
  test('an older seq keeps the position but counts as a message', () => {
    const s = apply(initialFleetState, t(tel(5, 48.5)), t(tel(2, 48.1)));
    expect(s.vehicles['veh-0001']!.telemetry.lat).toBe(48.5);
    expect(s.vehicles['veh-0001']!.trail).toHaveLength(1);
    expect(s.messages).toBe(2);
  });
  test('the trail is capped', () => {
    let s = initialFleetState;
    for (let i = 0; i < TRAIL_POINTS + 30; i++) s = apply(s, t(tel(i, 48 + i / 1000)));
    expect(s.vehicles['veh-0001']!.trail).toHaveLength(TRAIL_POINTS);
    expect(s.vehicles['veh-0001']!.trail.at(-1)![1]).toBeCloseTo(48 + (TRAIL_POINTS + 29) / 1000);
  });
  test('alerts dedupe by id, newest first, and are capped', () => {
    let s = apply(initialFleetState, { type: 'alert', alert: alert(1) }, { type: 'alert', alert: alert(2) }, { type: 'alert', alert: alert(1) });
    expect(s.alerts.map((a) => a.alertId)).toEqual(['a2', 'a1']);
    for (let i = 3; i < MAX_ALERTS + 10; i++) s = apply(s, { type: 'alert', alert: alert(i) });
    expect(s.alerts).toHaveLength(MAX_ALERTS);
    expect(s.alerts[0]!.alertId).toBe(`a${MAX_ALERTS + 9}`);
  });
  test('status updates a known vehicle and ignores unknown ones', () => {
    const known = apply(initialFleetState, t(tel(1)), { type: 'status', vehicleId: 'veh-0001', online: false });
    expect(known.vehicles['veh-0001']!.online).toBe(false);
    const unknown = apply(initialFleetState, { type: 'status', vehicleId: 'veh-9', online: false });
    expect(unknown).toBe(initialFleetState);
  });
  test('select and geofences', () => {
    const s = apply(initialFleetState, { type: 'select', vehicleId: 'veh-0001' }, { type: 'geofences', geojson: { type: 'FeatureCollection', features: [] } });
    expect(s.selected).toBe('veh-0001');
    expect(s.geofences?.features).toEqual([]);
  });
});

test('mqttUrlFromLocation', () => {
  expect(mqttUrlFromLocation('?mqtt=ws%3A%2F%2Fmosquitto%3A9001', 'ws://localhost:5371')).toBe('ws://mosquitto:9001');
  expect(mqttUrlFromLocation('', 'ws://localhost:5371')).toBe('ws://localhost:5371');
});
