import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CollectingPublisher, handleCoreEvent } from '../src/index.js';
import { DynamoAlertStateRepo, createAlertStateTable } from '../src/dynamo-repo.js';

const URL_ = process.env.IOT_IT_DYNAMO_URL;
const config = { dwellMs: 60_000, minExitMs: 30_000 };

describe.skipIf(!URL_)('racing invocations against DynamoDB Local', () => {
  const table = `AlertState-${randomUUID()}`;
  const client = new DynamoDBClient({ endpoint: URL_, region: 'us-east-1', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  const doc = DynamoDBDocumentClient.from(client);
  beforeAll(async () => { await createAlertStateTable(client, table); });
  afterAll(async () => { await client.send(new DeleteTableCommand({ TableName: table })); client.destroy(); });

  test('racing ticks on one pair commit and publish exactly one alert (200 rounds)', async () => {
    const repo = new DynamoAlertStateRepo(doc, table);
    const t0 = performance.now();
    for (let round = 0; round < 200; round++) {
      const v = `v-${round}`;
      const pub = new CollectingPublisher();
      const deps = { repo, publisher: pub, config, maxAttempts: 8 };
      await handleCoreEvent({ kind: 'ENTER', eventId: 'e1', vehicleId: v, geofenceId: 'g', deviceTs: 0 }, deps);
      const tick = { kind: 'TICK', vehicleId: v, geofenceId: 'g', deviceTs: 61_000 } as const;
      await Promise.all([handleCoreEvent(tick, deps), handleCoreEvent(tick, deps), handleCoreEvent(tick, deps)]);
      const q = await doc.send(new QueryCommand({
        TableName: table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :a)',
        ExpressionAttributeValues: { ':pk': `VEH#${v}`, ':a': 'ALERT#' },
      }));
      expect(q.Items).toHaveLength(1);
      expect(pub.published).toHaveLength(1);
    }
    console.log(`200-round racing test took ${Math.round(performance.now() - t0)} ms`);
  }, 120_000);
});
