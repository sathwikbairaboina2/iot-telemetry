import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateTelemetry, type Telemetry } from '@iot-telemetry/schema';
import { MemorySeq, VirtualClock, depotBounds, loadRoutes, runFleet, type TelemetrySink } from '../src/index.js';

const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const routes = loadRoutes(read('../../../data/routes/munich.geojson'));
const depot = depotBounds(read('../../../data/geofences/depot-north.geojson'));
const START = Date.UTC(2026, 9, 4, 8);

export function capture() {
  const messages: Telemetry[] = [];
  const online: Array<[string, boolean]> = [];
  const sink: TelemetrySink = {
    async publish(t) { messages.push(t); },
    async setOnline(id, on) { online.push([id, on]); },
  };
  return { messages, online, sink };
}

const run = (over: Partial<Parameters<typeof runFleet>[0]> = {}) => {
  const c = capture();
  const p = runFleet({
    count: 5, hz: 1, durationMs: 60_000, seed: 42, routes, scenarios: [], depot,
    clock: new VirtualClock(START), sink: c.sink, seq: new MemorySeq(), ...over,
  });
  return p.then((stats) => ({ ...c, stats }));
};

describe('runFleet', () => {
  test('5 vehicles for 60 s at 1 Hz publish 300 valid messages', async () => {
    const r = await run();
    expect(r.messages).toHaveLength(300);
    expect(r.stats).toMatchObject({ published: 300, buffered: 0, ticks: 60 });
    for (const m of r.messages) expect(validateTelemetry(m).ok).toBe(true);
  });
  test('seq per vehicle is 0..59 in order', async () => {
    const r = await run();
    const byVeh = new Map<string, number[]>();
    for (const m of r.messages) byVeh.set(m.vehicleId, [...(byVeh.get(m.vehicleId) ?? []), m.seq]);
    expect(byVeh.size).toBe(5);
    for (const seqs of byVeh.values()) expect(seqs).toEqual(Array.from({ length: 60 }, (_, i) => i));
  });
  test('same seed, identical output', async () => {
    expect((await run()).messages).toEqual((await run()).messages);
  });
  test('hz 2 doubles the count', async () => {
    expect((await run({ hz: 2 })).messages).toHaveLength(600);
  });
});
