import { expect, test } from 'vitest';
import type { PairState, PairStatus } from '@iot-telemetry/alert-core';
import { alertKey, fromItem, stateKey, toItem } from '../src/dynamo-repo.js';

test('keys', () => {
  expect(stateKey('v1', 'g1')).toEqual({ pk: 'VEH#v1', sk: 'GF#g1' });
  expect(alertKey({ alertId: 'x', type: 'ENTERED', vehicleId: 'v1', geofenceId: 'g1', confirmedAt: 60000, triggerEventId: null }))
    .toEqual({ pk: 'VEH#v1', sk: 'ALERT#000000000060000#g1#ENTERED' });
});

const statuses: PairStatus[] = ['OUTSIDE', 'PENDING_IN', 'INSIDE', 'PENDING_OUT'];
test.each(statuses)('toItem/fromItem round trip for %s', (status) => {
  const s: PairState = { status, since: status === 'OUTSIDE' ? null : 123, lastEventTs: 456, idsAtLastTs: ['a', 'b'] };
  const item = toItem('v1', 'g1', s, 7);
  expect(fromItem(item)).toEqual({ state: s, version: 7 });
  expect('pending' in item).toBe(status === 'PENDING_IN' || status === 'PENDING_OUT');
});
test('null since and lastEventTs are stored as absent attributes', () => {
  const item = toItem('v', 'g', { status: 'OUTSIDE', since: null, lastEventTs: null, idsAtLastTs: [] }, 1);
  expect('since' in item).toBe(false);
  expect('lastEventTs' in item).toBe(false);
});
test('a missing item is version 0', () => {
  expect(fromItem(undefined).version).toBe(0);
  expect(fromItem(undefined).state.status).toBe('OUTSIDE');
});
