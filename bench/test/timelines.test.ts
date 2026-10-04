import { expect, test } from 'vitest';
import { mulberry32 } from '@iot-telemetry/sim';
import { randomTimeline } from '../src/timelines.js';

test('randomTimeline strictly alternates ENTER and EXIT, like a geofence service', () => {
  const rng = mulberry32(3);
  for (let i = 0; i < 200; i++) {
    const tl = randomTimeline(rng, { maxEvents: 25 });
    tl.forEach((e, j) => { if (j > 0) expect(e.kind).not.toBe(tl[j - 1]!.kind); });
  }
});
