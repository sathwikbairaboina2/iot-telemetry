import { describe, expect, test, vi } from 'vitest';
import type { CoreEvent } from '@iot-telemetry/alert-core';
import { CollectingPublisher, ConcurrencyError, MemoryAlertStateRepo, handleCoreEvent, type AlertStateRepo } from '../src/index.js';

const config = { dwellMs: 60_000, minExitMs: 30_000 };
const enter = (id: string, ts: number): CoreEvent => ({ kind: 'ENTER', eventId: id, vehicleId: 'v', geofenceId: 'g', deviceTs: ts });
const tick = (ts: number): CoreEvent => ({ kind: 'TICK', vehicleId: 'v', geofenceId: 'g', deviceTs: ts });

describe('handleCoreEvent', () => {
  test('ENTER then TICK after dwell stores and publishes one alert', async () => {
    const repo = new MemoryAlertStateRepo();
    const publisher = new CollectingPublisher();
    const deps = { repo, publisher, config };
    await handleCoreEvent(enter('e1', 0), deps);
    const r = await handleCoreEvent(tick(61_000), deps);
    expect(r.state.status).toBe('INSIDE');
    expect(repo.alerts()).toHaveLength(1);
    expect(publisher.published).toHaveLength(1);
  });

  test('a duplicate redelivery does not commit or publish', async () => {
    const repo = new MemoryAlertStateRepo();
    const spy = vi.spyOn(repo, 'commit');
    const publisher = new CollectingPublisher();
    const deps = { repo, publisher, config };
    await handleCoreEvent(enter('e1', 0), deps);
    const r = await handleCoreEvent(enter('e1', 0), deps);
    expect(r.outcome).toBe('duplicate');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(publisher.published).toHaveLength(0);
  });

  test('retries after conflicts and reports the attempt count', async () => {
    const inner = new MemoryAlertStateRepo();
    let conflicts = 2;
    const repo: AlertStateRepo = {
      load: (v, g) => inner.load(v, g),
      listPending: () => inner.listPending(),
      commit: async (...args) => (conflicts-- > 0 ? 'conflict' : inner.commit(...args)),
    };
    const r = await handleCoreEvent(enter('e1', 0), { repo, publisher: new CollectingPublisher(), config });
    expect(r.attempts).toBe(3);
  });

  test('gives up with ConcurrencyError after 5 conflicts and publishes nothing', async () => {
    const inner = new MemoryAlertStateRepo();
    const publisher = new CollectingPublisher();
    const commit = vi.fn(async () => 'conflict' as const);
    const repo: AlertStateRepo = { load: (v, g) => inner.load(v, g), listPending: () => inner.listPending(), commit };
    await expect(handleCoreEvent(enter('e1', 0), { repo, publisher, config })).rejects.toBeInstanceOf(ConcurrencyError);
    expect(commit).toHaveBeenCalledTimes(5);
    expect(publisher.published).toHaveLength(0);
  });

  test('a publish failure after commit is not retried: at-most-once notifications', async () => {
    const repo = new MemoryAlertStateRepo();
    const publish = vi.fn().mockRejectedValueOnce(new Error('sns down')).mockResolvedValue(undefined);
    const deps = { repo, publisher: { publish }, config };
    await handleCoreEvent(enter('e1', 0), deps);
    const tickEvent = tick(61_000);
    await expect(handleCoreEvent(tickEvent, deps)).rejects.toThrow('sns down');
    expect(repo.alerts()).toHaveLength(1);
    await handleCoreEvent(tickEvent, deps); // the retry finds the state already committed
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
