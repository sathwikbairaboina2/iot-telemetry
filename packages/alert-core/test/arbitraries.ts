import fc from 'fast-check';
import type { GeofenceEvent } from '../src/index.js';
export const timelineArb = fc.array(
  fc.record({ kind: fc.constantFrom<'ENTER' | 'EXIT'>('ENTER', 'EXIT'), gapS: fc.integer({ min: 0, max: 120 }) }),
  { minLength: 1, maxLength: 25 },
).map((steps) => {
  let ts = 0;
  return steps.map((s, i): GeofenceEvent => { ts += s.gapS * 1000; return { kind: s.kind, eventId: `e${i}`, vehicleId: 'v', geofenceId: 'g', deviceTs: ts }; });
});
/** Re-deliver copies of events at positions after their original. */
export const withDuplicatesArb = timelineArb.chain((events) =>
  fc.array(fc.record({ src: fc.nat(), extra: fc.nat() }), { maxLength: 20 }).map((dups) => {
    const out = [...events];
    for (const d of dups) {
      const srcIdx = d.src % out.length;
      const pos = srcIdx + 1 + (d.extra % (out.length - srcIdx));
      out.splice(pos, 0, out[srcIdx]!);
    }
    return { events, delivered: out };
  }));
