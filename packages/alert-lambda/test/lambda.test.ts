import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CollectingPublisher, MemoryAlertStateRepo, handleCoreEvent, type AlertStateRepo } from '../src/index.js';
import { createHandler } from '../src/lambda.js';

const enterEvent = () => {
  const e = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/location-enter.json', import.meta.url)), 'utf8'));
  e.detail.SampleTime = new Date(0).toISOString();
  return e;
};

test('geofence event is applied, then a sweep confirms the dwell', async () => {
  const repo = new MemoryAlertStateRepo();
  const publisher = new CollectingPublisher();
  const h = createHandler({ repo, publisher, config: { dwellMs: 60_000, minExitMs: 30_000 } }, () => 61_000);
  expect(await h(enterEvent())).toEqual({ handled: 1, failed: 0, outcomes: ['applied'] });
  expect(publisher.published).toHaveLength(0);
  expect(await h({ source: 'iot-telemetry.sweep' })).toEqual({ handled: 1, failed: 0, outcomes: ['tick'] });
  expect(publisher.published).toHaveLength(1);
  expect(publisher.published[0]!.type).toBe('ENTERED');
});

test('a sweep with nothing pending handles zero', async () => {
  const h = createHandler({ repo: new MemoryAlertStateRepo(), publisher: new CollectingPublisher(), config: { dwellMs: 1, minExitMs: 1 } }, () => 0);
  expect(await h({ source: 'iot-telemetry.sweep' })).toEqual({ handled: 0, failed: 0, outcomes: [] });
});

test('unknown events are rejected', async () => {
  const h = createHandler({ repo: new MemoryAlertStateRepo(), publisher: new CollectingPublisher(), config: { dwellMs: 1, minExitMs: 1 } }, () => 0);
  await expect(h({ foo: 1 })).rejects.toThrow('unsupported event');
});

test('one failing pair does not stop the sweep for the others', async () => {
  const inner = new MemoryAlertStateRepo();
  const config = { dwellMs: 60_000, minExitMs: 30_000 };
  const deps = { repo: inner, publisher: new CollectingPublisher(), config };
  for (const v of ['v1', 'v2']) await handleCoreEvent({ kind: 'ENTER', eventId: v, vehicleId: v, geofenceId: 'g', deviceTs: 0 }, deps);
  const repo: AlertStateRepo = {
    load: (v, g) => (v === 'v1' ? Promise.reject(new Error('boom')) : inner.load(v, g)),
    listPending: () => inner.listPending(),
    commit: (...a) => inner.commit(...a),
  };
  const h = createHandler({ ...deps, repo }, () => 61_000);
  const r = await h({ source: 'iot-telemetry.sweep' });
  expect(r.failed).toBe(1);
  expect(r.handled).toBe(1);
  expect(deps.publisher.published.map((a) => a.vehicleId)).toEqual(['v2']);
});

test('the sweep throws when every pair fails', async () => {
  const inner = new MemoryAlertStateRepo();
  const config = { dwellMs: 60_000, minExitMs: 30_000 };
  await handleCoreEvent({ kind: 'ENTER', eventId: 'a', vehicleId: 'v1', geofenceId: 'g', deviceTs: 0 }, { repo: inner, publisher: new CollectingPublisher(), config });
  const repo: AlertStateRepo = { load: () => Promise.reject(new Error('boom')), listPending: () => inner.listPending(), commit: (...a) => inner.commit(...a) };
  const h = createHandler({ repo, publisher: new CollectingPublisher(), config }, () => 61_000);
  await expect(h({ source: 'iot-telemetry.sweep' })).rejects.toThrow('boom');
});
