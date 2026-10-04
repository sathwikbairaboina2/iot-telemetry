import type { GeofenceEvent } from '@iot-telemetry/alert-core';
import type { Rng } from '@iot-telemetry/sim';

/** ENTER/EXIT sequences with 0-120 s gaps that strictly alternate, as a geofence service emits them (only on a state change). */
export function randomTimeline(rng: Rng, opts: { maxEvents: number }): GeofenceEvent[] {
  const n = 1 + Math.floor(rng() * opts.maxEvents);
  let ts = 0;
  let enter = rng() < 0.5;
  const out: GeofenceEvent[] = [];
  for (let i = 0; i < n; i++) {
    ts += Math.floor(rng() * 121) * 1000;
    out.push({ kind: enter ? 'ENTER' : 'EXIT', eventId: `e${i}`, vehicleId: 'v', geofenceId: 'g', deviceTs: ts });
    enter = !enter;
  }
  return out;
}

/** At-least-once delivery: each event is redelivered with probability `rate`, at a random later position. */
export function withDuplicates(rng: Rng, events: GeofenceEvent[], rate: number): GeofenceEvent[] {
  const out = [...events];
  // from the back, so an insertion never shifts the original of an event we have yet to visit
  for (let i = events.length - 1; i >= 0; i--) {
    if (rng() < rate) out.splice(i + 1 + Math.floor(rng() * (out.length - i)), 0, events[i]!);
  }
  return out;
}

/** Network reordering: each delivery is displaced by up to `windowMs` of event time. */
export function shuffleWithinWindow(rng: Rng, events: GeofenceEvent[], windowMs: number): GeofenceEvent[] {
  return events
    .map((e, i) => ({ e, key: e.deviceTs + rng() * windowMs, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((x) => x.e);
}
