import { describe, expect, test } from 'vitest';
import { step, initialState, type CoreEvent, type PairState } from '../src/index.js';

const cfg = { dwellMs: 60_000, minExitMs: 30_000 };
const enter = (id: string, s: number): CoreEvent => ({ kind: 'ENTER', eventId: id, vehicleId: 'v1', geofenceId: 'g1', deviceTs: s * 1000 });
const exit = (id: string, s: number): CoreEvent => ({ kind: 'EXIT', eventId: id, vehicleId: 'v1', geofenceId: 'g1', deviceTs: s * 1000 });
const tick = (s: number): CoreEvent => ({ kind: 'TICK', vehicleId: 'v1', geofenceId: 'g1', deviceTs: s * 1000 });
const play = (events: CoreEvent[], start: PairState = initialState) => {
  let state = start; const alerts = []; const outcomes = [];
  for (const e of events) { const r = step(state, e, cfg); state = r.state; alerts.push(...r.emitted); outcomes.push(r.outcome); }
  return { state, alerts, outcomes };
};

describe('step', () => {
  test('ENTER starts a pending entry without an alert', () => {
    const r = play([enter('a', 0)]);
    expect(r.state.status).toBe('PENDING_IN'); expect(r.alerts).toEqual([]);
  });
  test('TICK after dwell confirms ENTERED at since + dwell', () => {
    const r = play([enter('a', 10), tick(75)]);
    expect(r.state.status).toBe('INSIDE');
    expect(r.alerts).toEqual([{ alertId: 'v1:g1:ENTERED:70000', type: 'ENTERED', vehicleId: 'v1', geofenceId: 'g1', confirmedAt: 70_000, triggerEventId: null }]);
  });
  test('TICK exactly at the threshold confirms (>=)', () => { expect(play([enter('a', 0), tick(60)]).alerts).toHaveLength(1); });
  test('TICK before dwell does nothing', () => { expect(play([enter('a', 0), tick(59)]).state.status).toBe('PENDING_IN'); });
  test('EXIT before dwell cancels the entry (loiter)', () => {
    const r = play([enter('a', 0), exit('b', 5), enter('c', 10), exit('d', 15), tick(200)]);
    expect(r.alerts).toEqual([]); expect(r.state.status).toBe('OUTSIDE');
  });
  test('an event after the dwell confirms first, then applies', () => {
    const r = play([enter('a', 0), exit('b', 100)]);
    expect(r.alerts.map((a) => a.type)).toEqual(['ENTERED']);
    expect(r.alerts[0]!.triggerEventId).toBe('b');
    expect(r.state.status).toBe('PENDING_OUT');
  });
  test('short exit is absorbed (hysteresis)', () => {
    const r = play([enter('a', 0), tick(61), exit('b', 100), enter('c', 120), tick(400)]);
    expect(r.alerts.map((a) => a.type)).toEqual(['ENTERED']); expect(r.state.status).toBe('INSIDE');
  });
  test('exit confirmed after minExit', () => {
    const r = play([enter('a', 0), tick(61), exit('b', 100), tick(130)]);
    expect(r.alerts.map((a) => [a.type, a.confirmedAt])).toEqual([['ENTERED', 60_000], ['EXITED', 130_000]]);
    expect(r.state.status).toBe('OUTSIDE');
  });
  test('immediate redelivery is a duplicate', () => {
    expect(play([enter('a', 0), enter('a', 0)]).outcomes).toEqual(['applied', 'duplicate']);
  });
  test('redelivery at the same timestamp after another event is a duplicate', () => {
    const r = play([enter('a', 0), exit('b', 0), enter('a', 0)]);
    expect(r.outcomes).toEqual(['applied', 'applied', 'duplicate']); expect(r.state.status).toBe('OUTSIDE');
  });
  test('older event is late and changes nothing', () => {
    const before = play([enter('a', 50)]).state;
    const r = step(before, exit('old', 10), cfg);
    expect(r.outcome).toBe('late_ignored'); expect(r.state).toBe(before); expect(r.emitted).toEqual([]);
  });
  test('ENTER while pending or inside is redundant', () => {
    expect(play([enter('a', 0), enter('b', 5)]).outcomes).toEqual(['applied', 'redundant']);
  });
  test('TICK does not advance lastEventTs', () => {
    const r = play([enter('a', 0), tick(500)]);
    expect(r.state.lastEventTs).toBe(0);
    expect(step(r.state, exit('b', 100), cfg).outcome).toBe('applied');
  });
  test('since is clamped so a late-ordered EXIT cannot precede the confirmation', () => {
    const r = play([enter('a', 0), tick(500), exit('b', 100), tick(1000)]);
    expect(r.alerts.map((a) => [a.type, a.confirmedAt])).toEqual([['ENTERED', 60_000], ['EXITED', 130_000]]);
    const r2 = play([enter('a', 0), tick(90), exit('b', 70), tick(1000)]);
    expect(r2.alerts.map((a) => [a.type, a.confirmedAt])).toEqual([['ENTERED', 60_000], ['EXITED', 100_000]]);
  });
  test('zero thresholds confirm immediately', () => {
    const r = [enter('a', 0)].map((e) => step(initialState, e, { dwellMs: 0, minExitMs: 0 }))[0]!;
    expect(r.state.status).toBe('INSIDE'); expect(r.emitted).toHaveLength(1);
  });
  test('inputs are not mutated', () => {
    const s = Object.freeze({ ...initialState });
    expect(() => step(s, enter('a', 0), cfg)).not.toThrow();
  });
});
