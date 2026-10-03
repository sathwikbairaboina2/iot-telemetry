import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runAlertsBench } from './alerts-bench.js';
import { runLatencyBench } from './latency-bench.js';

const RESULTS = fileURLToPath(new URL('../results/latest.json', import.meta.url));

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      only: { type: 'string', default: 'all' }, vehicles: { type: 'string', default: '200' }, hz: { type: 'string', default: '1' },
      duration: { type: 'string', default: '60' }, timelines: { type: 'string', default: '1000' }, seed: { type: 'string', default: '42' },
    },
  });
  const only = values.only as string;
  if (!['all', 'alerts', 'latency'].includes(only)) throw new Error(`--only must be alerts, latency or all, got ${only}`);

  const previous = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, 'utf8')) as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {
    ...previous,
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version, platform: process.platform, broker: 'eclipse-mosquitto:2.1.2-alpine', where: process.env.BENCH_WHERE ?? 'host',
    },
  };

  if (only === 'all' || only === 'latency') {
    console.log('latency bench ...');
    out.latency = await runLatencyBench({
      mqttUrl: process.env.MQTT_URL ?? 'mqtt://localhost:5370',
      wsUrl: process.env.MQTT_WS_URL ?? 'ws://localhost:5371',
      vehicles: Number(values.vehicles), hz: Number(values.hz), durationS: Number(values.duration),
    });
  }
  if (only === 'all' || only === 'alerts') {
    console.log('alerts bench ...');
    out.alerts = {
      seed: Number(values.seed), duplicateRate: 0.2,
      ...(await runAlertsBench({ timelines: Number(values.timelines), seed: Number(values.seed), duplicateRate: 0.2 })),
    };
  }

  mkdirSync(dirname(RESULTS), { recursive: true });
  writeFileSync(RESULTS, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
}

main().then(() => process.exit(0), (err: unknown) => { console.error(err); process.exit(1); });
