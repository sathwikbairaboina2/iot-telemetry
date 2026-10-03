import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CollectingPublisher, MemoryAlertStateRepo } from '../src/index.js';
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
  expect(await h(enterEvent())).toEqual({ handled: 1, outcomes: ['applied'] });
  expect(publisher.published).toHaveLength(0);
  expect(await h({ source: 'iot-telemetry.sweep' })).toEqual({ handled: 1, outcomes: ['tick'] });
  expect(publisher.published).toHaveLength(1);
  expect(publisher.published[0]!.type).toBe('ENTERED');
});

test('a sweep with nothing pending handles zero', async () => {
  const h = createHandler({ repo: new MemoryAlertStateRepo(), publisher: new CollectingPublisher(), config: { dwellMs: 1, minExitMs: 1 } }, () => 0);
  expect(await h({ source: 'iot-telemetry.sweep' })).toEqual({ handled: 0, outcomes: [] });
});

test('unknown events are rejected', async () => {
  const h = createHandler({ repo: new MemoryAlertStateRepo(), publisher: new CollectingPublisher(), config: { dwellMs: 1, minExitMs: 1 } }, () => 0);
  await expect(h({ foo: 1 })).rejects.toThrow('unsupported event');
});
