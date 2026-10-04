import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '@iot-telemetry/alert-core';
import { CollectingPublisher, MemoryAlertStateRepo, handleCoreEvent } from '@iot-telemetry/alert-lambda';
import { loadFixtures, type Telemetry } from '@iot-telemetry/schema';
import { MemorySink, createPipeline, loadGeofences, type QuarantineRecord } from '../src/index.js';

const geofences = loadGeofences(JSON.parse(readFileSync(fileURLToPath(new URL('../../../data/geofences/depot-north.geojson', import.meta.url)), 'utf8')));
const base = loadFixtures('valid')[0]!.payload as Telemetry;
const make = () => {
  const history = new MemorySink<Telemetry>();
  const quarantine = new MemorySink<QuarantineRecord>();
  const publisher = new CollectingPublisher();
  const p = createPipeline({
    repo: new MemoryAlertStateRepo(), publisher, config: DEFAULT_CONFIG, geofences, history, quarantine,
    receivedAt: () => '2026-10-04T08:00:00.000Z',
  });
  return { p, history, quarantine, publisher };
};
const msg = (seq: number, sec: number, lat: number): Telemetry => ({
  ...base, vehicleId: 'veh-0042', seq, ts: new Date(Date.UTC(2026, 9, 4, 8, 0, sec)).toISOString(), lat, lon: 11.5675,
});
const topic = 'fleet/veh-0042/telemetry';

describe('pipeline', () => {
  test('an invalid message goes to quarantine and nowhere else', async () => {
    const { p, history, quarantine } = make();
    const bad = loadFixtures('invalid').find((f) => f.name === 'missing-lat')!;
    await p.handle(bad.topic, JSON.stringify(bad.payload));
    expect(quarantine.records).toHaveLength(1);
    expect(quarantine.records[0]).toMatchObject({ reason: 'rule_sql', receivedAt: '2026-10-04T08:00:00.000Z' });
    expect(history.records).toHaveLength(0);
    expect(p.latest().size).toBe(0);
    expect(p.stats()).toMatchObject({ received: 1, quarantined: 1, valid: 0 });
  });

  test('a valid message goes to history and latest', async () => {
    const { p, history, quarantine } = make();
    await p.handle(topic, JSON.stringify(msg(5, 0, 48.1)));
    expect(history.records).toHaveLength(1);
    expect(quarantine.records).toHaveLength(0);
    expect(p.latest().get('veh-0042')!.seq).toBe(5);
  });

  test('an older seq does not overwrite latest', async () => {
    const { p } = make();
    await p.handle(topic, JSON.stringify(msg(5, 5, 48.1)));
    await p.handle(topic, JSON.stringify(msg(2, 2, 48.2)));
    expect(p.latest().get('veh-0042')!.seq).toBe(5);
  });

  test('schema violations are counted, not dropped', async () => {
    const { p, history } = make();
    const f = loadFixtures('invalid').find((x) => x.name === 'extra-field')!;
    await p.handle(f.topic, JSON.stringify(f.payload));
    expect(p.stats().schemaViolations).toBe(1);
    expect(history.records).toHaveLength(1);
  });

  test('in, then later telemetry, confirms an ENTERED alert via ticks', async () => {
    const { p, publisher } = make();
    await p.handle(topic, JSON.stringify(msg(0, 0, 48.1)));
    await p.handle(topic, JSON.stringify(msg(1, 10, 48.154)));
    await p.handle(topic, JSON.stringify(msg(2, 40, 48.154)));
    expect(publisher.published).toHaveLength(0);
    await p.handle(topic, JSON.stringify(msg(3, 75, 48.154)));
    expect(publisher.published.map((a) => [a.type, a.confirmedAt])).toEqual([['ENTERED', Date.UTC(2026, 9, 4, 8, 1, 10)]]);
    expect(p.stats().alerts).toBe(1);
  });

  test('a restarted pipeline resumes a pending dwell from the repo', async () => {
    const repo = new MemoryAlertStateRepo();
    const publisher = new CollectingPublisher();
    const mk = () => createPipeline({ repo, publisher, config: DEFAULT_CONFIG, geofences, history: new MemorySink<Telemetry>(), quarantine: new MemorySink<QuarantineRecord>() });
    // a pair left PENDING_IN by a previous process
    await handleCoreEvent({ kind: 'ENTER', eventId: 'e1', vehicleId: 'veh-0042', geofenceId: 'depot-north', deviceTs: Date.UTC(2026, 9, 4, 8, 0, 0) }, { repo, publisher, config: DEFAULT_CONFIG });
    const p = mk();
    await p.handle(topic, JSON.stringify(msg(9, 120, 48.1)));
    expect(publisher.published.map((a) => a.type)).toEqual(['ENTERED']);
  });
});
