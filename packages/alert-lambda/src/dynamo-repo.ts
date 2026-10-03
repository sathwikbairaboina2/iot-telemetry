import { CreateTableCommand, ResourceInUseException, type DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QueryCommand, GetCommand, TransactWriteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { initialState, isPending, type Alert, type PairState, type PairStatus } from '@iot-telemetry/alert-core';
import type { AlertStateRepo, CommitResult, PairRef, StoredState } from './repo.js';

export const ALERT_STATE_GSI = 'pending-index';

export function stateKey(vehicleId: string, geofenceId: string): { pk: string; sk: string } {
  return { pk: `VEH#${vehicleId}`, sk: `GF#${geofenceId}` };
}

export function alertKey(a: Alert): { pk: string; sk: string } {
  return { pk: `VEH#${a.vehicleId}`, sk: `ALERT#${String(a.confirmedAt).padStart(15, '0')}#${a.geofenceId}#${a.type}` };
}

export function toItem(vehicleId: string, geofenceId: string, s: PairState, version: number): Record<string, unknown> {
  const item: Record<string, unknown> = {
    ...stateKey(vehicleId, geofenceId),
    vehicleId, geofenceId, status: s.status, idsAtLastTs: [...s.idsAtLastTs], version,
  };
  if (s.since !== null) item.since = s.since;
  if (s.lastEventTs !== null) item.lastEventTs = s.lastEventTs;
  if (isPending(s)) item.pending = '1';
  return item;
}

export function fromItem(item: Record<string, unknown> | undefined): StoredState {
  if (!item) return { state: initialState, version: 0 };
  return {
    state: {
      status: item.status as PairStatus,
      since: typeof item.since === 'number' ? item.since : null,
      lastEventTs: typeof item.lastEventTs === 'number' ? item.lastEventTs : null,
      idsAtLastTs: (item.idsAtLastTs as string[] | undefined) ?? [],
    },
    version: item.version as number,
  };
}

const CONFLICT_CODES = new Set(['ConditionalCheckFailed', 'TransactionConflict', 'None']);

function isConflict(err: unknown): boolean {
  const e = err as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
  if (e?.name !== 'TransactionCanceledException') return false;
  const reasons = e.CancellationReasons ?? [];
  return reasons.length > 0 && reasons.every((r) => CONFLICT_CODES.has(r.Code ?? 'None'));
}

export class DynamoAlertStateRepo implements AlertStateRepo {
  constructor(private readonly doc: DynamoDBDocumentClient, private readonly tableName: string) {}

  async load(vehicleId: string, geofenceId: string): Promise<StoredState> {
    const r = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: stateKey(vehicleId, geofenceId), ConsistentRead: true }));
    return fromItem(r.Item);
  }

  async commit(vehicleId: string, geofenceId: string, expectedVersion: number, next: PairState, alerts: readonly Alert[]): Promise<CommitResult> {
    const stateItem = toItem(vehicleId, geofenceId, next, expectedVersion + 1);
    const items = [
      expectedVersion === 0
        ? { Put: { TableName: this.tableName, Item: stateItem, ConditionExpression: 'attribute_not_exists(pk)' } }
        : {
            Put: {
              TableName: this.tableName, Item: stateItem, ConditionExpression: '#v = :expected',
              ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':expected': expectedVersion },
            },
          },
      ...alerts.map((a) => ({
        Put: {
          TableName: this.tableName,
          Item: { ...alertKey(a), alertId: a.alertId, type: a.type, vehicleId: a.vehicleId, geofenceId: a.geofenceId, confirmedAt: a.confirmedAt, triggerEventId: a.triggerEventId },
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      })),
    ];
    try {
      await this.doc.send(new TransactWriteCommand({ TransactItems: items }));
      return 'ok';
    } catch (err) {
      if (isConflict(err)) return 'conflict';
      throw err;
    }
  }

  async listPending(): Promise<PairRef[]> {
    const out: PairRef[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(new QueryCommand({
        TableName: this.tableName, IndexName: ALERT_STATE_GSI, KeyConditionExpression: 'pending = :one',
        ExpressionAttributeValues: { ':one': '1' }, ExclusiveStartKey: key,
      }));
      for (const i of r.Items ?? []) out.push({ vehicleId: i.vehicleId as string, geofenceId: i.geofenceId as string });
      key = r.LastEvaluatedKey;
    } while (key);
    return out;
  }
}

/** Idempotent. Used by the local pipeline and the integration tests; the cloud table comes from CDK. */
export async function createAlertStateTable(client: DynamoDBClient, tableName: string): Promise<void> {
  try {
    await client.send(new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }, { AttributeName: 'pending', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
      GlobalSecondaryIndexes: [{
        IndexName: ALERT_STATE_GSI,
        KeySchema: [{ AttributeName: 'pending', KeyType: 'HASH' }, { AttributeName: 'pk', KeyType: 'RANGE' }],
        Projection: { ProjectionType: 'ALL' },
      }],
    }));
  } catch (err) {
    if (err instanceof ResourceInUseException || (err as { name?: string }).name === 'ResourceInUseException') return;
    throw err;
  }
}
