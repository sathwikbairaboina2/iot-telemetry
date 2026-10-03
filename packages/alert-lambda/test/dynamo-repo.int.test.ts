import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Alert, PairState } from '@iot-telemetry/alert-core';
import { DynamoAlertStateRepo, createAlertStateTable } from '../src/dynamo-repo.js';

const URL_ = process.env.IOT_IT_DYNAMO_URL;

const pending: PairState = { status: 'PENDING_IN', since: 1000, lastEventTs: 1000, idsAtLastTs: ['e1'] };
const inside: PairState = { status: 'INSIDE', since: 61000, lastEventTs: 1000, idsAtLastTs: ['e1'] };
const alert = (id: string): Alert => ({ alertId: id, type: 'ENTERED', vehicleId: 'v', geofenceId: 'g', confirmedAt: 61000, triggerEventId: null });

describe.skipIf(!URL_)('DynamoAlertStateRepo against DynamoDB Local', () => {
  const table = `AlertState-${randomUUID()}`;
  const client = new DynamoDBClient({ endpoint: URL_, region: 'us-east-1', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  const repo = new DynamoAlertStateRepo(DynamoDBDocumentClient.from(client), table);
  beforeAll(async () => { await createAlertStateTable(client, table); });
  afterAll(async () => { await client.send(new DeleteTableCommand({ TableName: table })); client.destroy(); });

  test('missing pair is version 0; commit then load gives version 1', async () => {
    expect((await repo.load('v1', 'g')).version).toBe(0);
    expect(await repo.commit('v1', 'g', 0, pending, [])).toBe('ok');
    const l = await repo.load('v1', 'g');
    expect(l.version).toBe(1);
    expect(l.state).toEqual(pending);
  });
  test('stale version is a conflict', async () => {
    expect(await repo.commit('v1', 'g', 0, inside, [])).toBe('conflict');
    expect(await repo.commit('v1', 'g', 1, inside, [alert('a1')])).toBe('ok');
  });
  test('re-inserting an existing alert is a conflict', async () => {
    expect(await repo.commit('v1', 'g', 2, inside, [alert('a1')])).toBe('conflict');
    expect((await repo.load('v1', 'g')).version).toBe(2);
  });
  test('listPending returns PENDING pairs only', async () => {
    await repo.commit('v2', 'g', 0, pending, []);
    await repo.commit('v3', 'g', 0, inside, []);
    const p = await repo.listPending();
    expect(p).toContainEqual({ vehicleId: 'v2', geofenceId: 'g' });
    expect(p).not.toContainEqual({ vehicleId: 'v3', geofenceId: 'g' });
    expect(p).not.toContainEqual({ vehicleId: 'v1', geofenceId: 'g' });
  });
});
