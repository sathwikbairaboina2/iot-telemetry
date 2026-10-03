import { expect, test, vi } from 'vitest';
import { CollectingPublisher, MemoryAlertStateRepo, handleCoreEvent } from '../src/index.js';

const config = { dwellMs: 60_000, minExitMs: 30_000 };
const yieldOnce = () => new Promise<void>((r) => setImmediate(r));

test('racing ticks on one pair commit and publish exactly one alert (200 rounds)', async () => {
  for (let round = 0; round < 200; round++) {
    const repo = new MemoryAlertStateRepo({ beforeCommit: yieldOnce });
    const pub = new CollectingPublisher();
    const deps = { repo, publisher: pub, config };
    await handleCoreEvent({ kind: 'ENTER', eventId: 'e1', vehicleId: 'v', geofenceId: 'g', deviceTs: 0 }, deps);
    const tick = { kind: 'TICK', vehicleId: 'v', geofenceId: 'g', deviceTs: 61_000 } as const;
    await Promise.all([handleCoreEvent(tick, deps), handleCoreEvent(tick, deps), handleCoreEvent(tick, deps)]);
    expect(repo.alerts()).toHaveLength(1);
    expect(pub.published).toHaveLength(1);
  }
});

test('three concurrent deliveries of one ENTER commit exactly once', async () => {
  const repo = new MemoryAlertStateRepo({ beforeCommit: yieldOnce });
  const spy = vi.spyOn(repo, 'commit');
  const deps = { repo, publisher: new CollectingPublisher(), config };
  const ev = { kind: 'ENTER', eventId: 'e1', vehicleId: 'v', geofenceId: 'g', deviceTs: 0 } as const;
  await Promise.all([handleCoreEvent(ev, deps), handleCoreEvent(ev, deps), handleCoreEvent(ev, deps)]);
  const results = await Promise.all(spy.mock.results.map((r) => r.value as Promise<string>));
  expect(results.filter((r) => r === 'ok')).toHaveLength(1);
  const stored = await repo.load('v', 'g');
  expect(stored.state.status).toBe('PENDING_IN');
  expect(stored.version).toBe(1);
});
