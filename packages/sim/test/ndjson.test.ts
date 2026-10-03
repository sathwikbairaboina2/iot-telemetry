import { expect, test } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Telemetry } from '@iot-telemetry/schema';
import {
  MemorySeq, NdjsonRecorderSink, VirtualClock, depotBounds, loadRoutes, readRecording, replay, runFleet, type TelemetrySink,
} from '../src/index.js';

const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const routes = loadRoutes(read('../../../data/routes/munich.geojson'));
const depot = depotBounds(read('../../../data/geofences/depot-north.geojson'));
const START = Date.UTC(2026, 9, 4, 8);

test('record then replay gives the same 60 messages in the same order', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'nd-')), 'rec.ndjson');
  const clock = new VirtualClock(START);
  const rec = new NdjsonRecorderSink(file, clock);
  const live: Telemetry[] = [];
  const both: TelemetrySink = {
    async publish(t) { live.push(t); await rec.publish(t); },
    async setOnline() {},
  };
  await runFleet({ count: 2, hz: 1, durationMs: 30_000, seed: 3, routes, scenarios: [], depot, clock, sink: both, seq: new MemorySeq() });
  const messages = readRecording(file);
  expect(messages).toHaveLength(60);
  for (let i = 1; i < messages.length; i++) expect(messages[i]!.publishAtMs).toBeGreaterThanOrEqual(messages[i - 1]!.publishAtMs);
  expect(messages.map((m) => m.telemetry)).toEqual(live);

  const replayed: Telemetry[] = [];
  const n = await replay(messages, { async publish(t) { replayed.push(t); }, async setOnline() {} }, { clock: new VirtualClock(0), speed: 10 });
  expect(n).toBe(60);
  expect(replayed).toEqual(live);
});
