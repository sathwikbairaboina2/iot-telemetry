import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Telemetry } from '@iot-telemetry/schema';
import { LOITER_ID, MemorySeq, TUNNEL_ID, VirtualClock, depotBounds, loadRoutes, runFleet, type TelemetrySink } from '../src/index.js';

const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const routes = loadRoutes(read('../../../data/routes/munich.geojson'));
const depot = depotBounds(read('../../../data/geofences/depot-north.geojson'));
const START = Date.UTC(2026, 9, 4, 8);

async function go(scenarios: Array<'loiter' | 'tunnel'>, durationMs: number) {
  const clock = new VirtualClock(START);
  const messages: Array<{ t: Telemetry; at: number }> = [];
  const online: Array<[string, boolean]> = [];
  const sink: TelemetrySink = {
    async publish(t) { messages.push({ t, at: clock.now() }); },
    async setOnline(id, on) { online.push([id, on]); },
  };
  const stats = await runFleet({ count: 0, hz: 1, durationMs, seed: 42, routes, scenarios, depot, clock, sink, seq: new MemorySeq() });
  return { messages, online, stats };
}

describe('loiter', () => {
  test('crosses the depot edge many times, then stays inside for 100 s or more', async () => {
    const { messages } = await go(['loiter'], 400_000);
    const lats = messages.filter((m) => m.t.vehicleId === LOITER_ID).map((m) => m.t.lat);
    let crossings = 0;
    for (let i = 1; i < lats.length; i++) if ((lats[i - 1]! - depot.south) * (lats[i]! - depot.south) < 0) crossings++;
    expect(crossings).toBeGreaterThanOrEqual(10);
    let run = 0; let best = 0;
    for (const lat of lats) { run = lat > depot.south ? run + 1 : 0; best = Math.max(best, run); }
    expect(best).toBeGreaterThanOrEqual(100);
  });
});

describe('tunnel', () => {
  test('buffers during the outage, flushes in order, no gaps', async () => {
    const { messages, online, stats } = await go(['tunnel'], 300_000);
    expect(stats.buffered).toBe(90);
    expect(stats.flushed).toBe(90);
    const mine = messages.filter((m) => m.t.vehicleId === TUNNEL_ID);
    expect(mine.map((m) => m.t.seq).sort((a, b) => a - b)).toEqual(Array.from({ length: 300 }, (_, i) => i));
    expect(mine.filter((m) => m.at > START + 30_000 && m.at < START + 120_000)).toHaveLength(0);
    const firstAfter = mine.find((m) => m.at >= START + 120_000)!;
    expect(firstAfter.t.seq).toBe(30);
    expect(Date.parse(firstAfter.t.ts)).toBe(START + 30_000);
    expect(online.filter(([id]) => id === TUNNEL_ID).map(([, on]) => on)).toEqual([true, false, true]);
  });
});
