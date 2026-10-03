import { expect, test } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFixtures, type Telemetry } from '@iot-telemetry/schema';
import { NdjsonHistorySink, NdjsonQuarantineSink } from '../src/index.js';

const base = loadFixtures('valid')[0]!.payload as Telemetry;

test('history is partitioned by telemetry hour', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hist-'));
  const sink = new NdjsonHistorySink(root);
  await sink.write({ ...base, ts: '2026-10-04T08:15:00.000Z' });
  await sink.write({ ...base, ts: '2026-10-04T08:45:00.000Z' });
  await sink.write({ ...base, ts: '2026-10-04T09:05:00.000Z' });
  const dir = join(root, 'history', 'dt=2026-10-04');
  expect(readdirSync(dir).sort()).toEqual(['hour=08.ndjson', 'hour=09.ndjson']);
  const lines = readFileSync(join(dir, 'hour=08.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(lines).toHaveLength(2);
  expect(lines[0].ts).toBe('2026-10-04T08:15:00.000Z');
});

test('quarantine file is named by receivedAt date', async () => {
  const root = mkdtempSync(join(tmpdir(), 'quar-'));
  const sink = new NdjsonQuarantineSink(root);
  await sink.write({ topic: 'fleet/veh-0001/telemetry', receivedAt: '2026-10-05T00:00:01.000Z', reason: 'rule_sql', raw: { a: 1 } });
  expect(readdirSync(join(root, 'quarantine'))).toEqual(['dt=2026-10-05.ndjson']);
});
