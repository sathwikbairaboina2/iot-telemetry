import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import type { StepOutcome } from '@iot-telemetry/alert-core';
import { DynamoAlertStateRepo } from './dynamo-repo.js';
import { handleCoreEvent, type HandleDeps } from './handle.js';
import { isLocationGeofenceEvent, toCoreEvent } from './location-event.js';
import { SnsAlertPublisher } from './sns-publisher.js';

export interface SweepEvent { source: 'iot-telemetry.sweep' }
export interface HandlerResult { handled: number; failed: number; outcomes: StepOutcome[] }

const isSweep = (x: unknown): x is SweepEvent => !!x && typeof x === 'object' && (x as { source?: unknown }).source === 'iot-telemetry.sweep';

export function createHandler(deps: HandleDeps, now: () => number): (event: unknown) => Promise<HandlerResult> {
  return async (event) => {
    if (isLocationGeofenceEvent(event)) {
      const r = await handleCoreEvent(toCoreEvent(event), deps);
      return { handled: 1, failed: 0, outcomes: [r.outcome] };
    }
    if (isSweep(event)) {
      const pairs = await deps.repo.listPending();
      const outcomes: StepOutcome[] = [];
      const errors: unknown[] = [];
      // one failing pair must not hold back the others until the next sweep
      for (const p of pairs) {
        try {
          const r = await handleCoreEvent({ kind: 'TICK', vehicleId: p.vehicleId, geofenceId: p.geofenceId, deviceTs: now() }, deps);
          outcomes.push(r.outcome);
        } catch (err) {
          errors.push(err);
          console.error(JSON.stringify({ msg: 'sweep pair failed', vehicleId: p.vehicleId, geofenceId: p.geofenceId, error: String(err) }));
        }
      }
      if (errors.length > 0 && outcomes.length === 0) throw errors[0];
      return { handled: outcomes.length, failed: errors.length, outcomes };
    }
    throw new Error('unsupported event');
  };
}

let cached: ((event: unknown) => Promise<HandlerResult>) | undefined;

/** Clients are created once per container, on the first invocation. */
export const handler = (event: unknown): Promise<HandlerResult> => {
  cached ??= createHandler({
    repo: new DynamoAlertStateRepo(DynamoDBDocumentClient.from(new DynamoDBClient({})), process.env.TABLE_NAME ?? ''),
    publisher: new SnsAlertPublisher(new SNSClient({}), process.env.TOPIC_ARN ?? ''),
    config: {
      dwellMs: Number(process.env.DWELL_SECONDS ?? 60) * 1000,
      minExitMs: Number(process.env.MIN_EXIT_SECONDS ?? 30) * 1000,
    },
  }, () => Date.now());
  return cached(event);
};
