import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DEFAULT_CONFIG, type Alert } from '@iot-telemetry/alert-core';
import { DynamoAlertStateRepo, MemoryAlertStateRepo, createAlertStateTable, type AlertPublisher, type AlertStateRepo } from '@iot-telemetry/alert-lambda';
import { ALERTS_TOPIC, GEOFENCES_TOPIC, TELEMETRY_FILTER } from '@iot-telemetry/schema';
import { connectAsync } from 'mqtt';
import { loadGeofences } from './geofence-stub.js';
import { createPipeline, type PipelineStats } from './pipeline.js';
import { NdjsonHistorySink, NdjsonQuarantineSink } from './sinks.js';

export interface MainOptions {
  mqttUrl: string; geofenceFile: string; dataDir: string; dynamoUrl?: string; tableName?: string; duplicateRate?: number; seed?: number;
}

export function optionsFromEnv(env: NodeJS.ProcessEnv): MainOptions {
  return {
    mqttUrl: env.MQTT_URL ?? 'mqtt://localhost:5370',
    geofenceFile: env.GEOFENCE_FILE ?? 'data/geofences/depot-north.geojson',
    dataDir: env.DATA_DIR ?? 'var',
    dynamoUrl: env.DYNAMO_URL || undefined,
    tableName: env.ALERT_TABLE ?? 'AlertState',
    duplicateRate: Number(env.DUPLICATE_RATE ?? 0.2),
    seed: Number(env.SEED ?? 42),
  };
}

export async function startPipeline(opts: MainOptions): Promise<{ stop(): Promise<void>; stats(): PipelineStats }> {
  const geojson: unknown = JSON.parse(readFileSync(opts.geofenceFile, 'utf8'));
  const tableName = opts.tableName ?? 'AlertState';

  let repo: AlertStateRepo;
  let dynamo: DynamoDBClient | undefined;
  if (opts.dynamoUrl) {
    dynamo = new DynamoDBClient({
      endpoint: opts.dynamoUrl,
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local' },
    });
    await createAlertStateTable(dynamo, tableName);
    repo = new DynamoAlertStateRepo(DynamoDBDocumentClient.from(dynamo), tableName);
  } else {
    repo = new MemoryAlertStateRepo();
  }

  const client = await connectAsync(opts.mqttUrl, { clientId: 'iot-telemetry-pipeline' });

  const publisher: AlertPublisher = {
    async publish(a: Alert) {
      await client.publishAsync(ALERTS_TOPIC, JSON.stringify(a), { qos: 1 });
      console.log(`ALERT ${a.type} ${a.vehicleId} ${a.geofenceId} ${new Date(a.confirmedAt).toISOString()}`);
    },
  };
  const pipeline = createPipeline({
    repo, publisher, config: DEFAULT_CONFIG, geofences: loadGeofences(geojson),
    history: new NdjsonHistorySink(opts.dataDir), quarantine: new NdjsonQuarantineSink(opts.dataDir),
    duplicateRate: opts.duplicateRate, seed: opts.seed,
  });

  // strictly in arrival order: each message waits for the one before it
  let chain: Promise<void> = Promise.resolve();
  client.on('message', (topic, payload) => {
    chain = chain
      .then(() => pipeline.handle(topic, payload))
      .catch((err: unknown) => console.error('pipeline error', err instanceof Error ? err.message : err));
  });

  await client.publishAsync(GEOFENCES_TOPIC, JSON.stringify(geojson), { qos: 1, retain: true });
  await client.subscribeAsync(TELEMETRY_FILTER, { qos: 1 });

  const timer = setInterval(() => console.log(JSON.stringify({ stats: pipeline.stats() })), 10_000);

  return {
    stats: () => pipeline.stats(),
    async stop() {
      clearInterval(timer);
      await client.unsubscribeAsync(TELEMETRY_FILTER).catch(() => undefined);
      await chain;
      await client.endAsync();
      dynamo?.destroy();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startPipeline(optionsFromEnv(process.env)).then((p) => {
    console.log('pipeline started');
    const shutdown = () => { p.stop().finally(() => process.exit(0)); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }, (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
