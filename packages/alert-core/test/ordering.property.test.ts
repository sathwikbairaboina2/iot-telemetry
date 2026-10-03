import { expect, test } from 'vitest';
import fc from 'fast-check';
import { run, step, type Alert, type CoreEvent } from '../src/index.js';
import { timelineArb } from './arbitraries.js';
const cfg = { dwellMs: 60_000, minExitMs: 30_000 };
const safe = (alerts: Alert[]) => {
  alerts.forEach((a, i) => {
    expect(a.type).toBe(i % 2 === 0 ? 'ENTERED' : 'EXITED');
    if (i > 0) expect(a.confirmedAt).toBeGreaterThanOrEqual(alerts[i - 1]!.confirmedAt);
  });
  expect(new Set(alerts.map((a) => a.alertId)).size).toBe(alerts.length);
};

test('any permutation keeps alerts alternating, monotonic and unique', () => {
  fc.assert(fc.property(timelineArb.chain((ev) => fc.shuffledSubarray(ev, { minLength: ev.length, maxLength: ev.length })), (shuffled) => {
    safe(run(shuffled, cfg).alerts);
  }), { numRuns: 3000 });
});
test('ticks at arbitrary times keep confirmedAt monotonic', () => {
  const arb = timelineArb.chain((ev) => fc.tuple(
    fc.shuffledSubarray(ev, { minLength: ev.length, maxLength: ev.length }),
    fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 2400 })), { maxLength: 15 }),
  ).map(([shuffled, ticks]) => {
    const out: CoreEvent[] = [...shuffled];
    for (const [at, s] of ticks) out.splice(at % (out.length + 1), 0, { kind: 'TICK', vehicleId: 'v', geofenceId: 'g', deviceTs: s * 1000 });
    return out;
  }));
  fc.assert(fc.property(arb, (events) => { safe(run(events, cfg).alerts); }), { numRuns: 3000 });
});
test('a late event never changes state', () => {
  fc.assert(fc.property(timelineArb, fc.nat(), (events, k) => {
    const r = run(events, cfg);
    const late = events[k % events.length]!;
    if (r.state.lastEventTs === null || late.deviceTs >= r.state.lastEventTs) return;
    const s = step(r.state, late, cfg);
    expect(s.outcome).toBe('late_ignored'); expect(s.state).toBe(r.state);
  }), { numRuns: 2000 });
});
