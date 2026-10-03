#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { RealClock, VirtualClock } from './clock.js';
import { depotBounds } from './scenarios.js';
import { runFleet, type ScenarioName } from './fleet.js';
import { MqttFleetSink } from './mqtt-sink.js';
import { NdjsonRecorderSink, readRecording, replay } from './ndjson.js';
import { loadRoutes } from './routes.js';
import { MemorySeq, SeqAllocator } from './seq.js';

export interface FleetCliOptions {
  count: number; hz: number; durationS: number; scenarios: ScenarioName[]; seed: number; routes: string; geofence: string;
}
export type CliCommand =
  | ({ command: 'run'; broker: string; state: string } & FleetCliOptions)
  | ({ command: 'record'; out: string } & FleetCliOptions)
  | { command: 'replay'; file: string; broker: string; speed: number };

const SCENARIOS: ScenarioName[] = ['loiter', 'tunnel'];

function scenarioList(s: string): ScenarioName[] {
  const names = s.split(',').map((x) => x.trim()).filter(Boolean);
  for (const n of names) if (!SCENARIOS.includes(n as ScenarioName)) throw new Error(`Unknown scenario: ${n}`);
  return names as ScenarioName[];
}

export function parseCli(argv: string[], env: NodeJS.ProcessEnv = process.env): CliCommand {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      count: { type: 'string' }, hz: { type: 'string' }, duration: { type: 'string' }, broker: { type: 'string' },
      scenario: { type: 'string' }, seed: { type: 'string' }, routes: { type: 'string' }, geofence: { type: 'string' },
      state: { type: 'string' }, out: { type: 'string' }, file: { type: 'string' }, speed: { type: 'string' },
    },
  });
  const command = positionals[0];
  const num = (v: string | undefined, envVal: string | undefined, dflt: number): number => Number(v ?? envVal ?? dflt);
  const fleet = (dCount: number, dDuration: number, dScenario: string): FleetCliOptions => ({
    count: num(values.count, env.SIM_COUNT, dCount),
    hz: num(values.hz, env.SIM_HZ, 1),
    durationS: num(values.duration, undefined, dDuration),
    scenarios: scenarioList(values.scenario ?? env.SIM_SCENARIOS ?? dScenario),
    seed: num(values.seed, env.SIM_SEED, 42),
    routes: values.routes ?? 'data/routes/munich.geojson',
    geofence: values.geofence ?? 'data/geofences/depot-north.geojson',
  });
  const broker = values.broker ?? env.MQTT_URL ?? 'mqtt://localhost:5370';
  switch (command) {
    case 'run':
      return { command, broker, state: values.state ?? 'var/sim', ...fleet(50, 0, 'loiter,tunnel') };
    case 'record':
      return { command, out: values.out ?? 'var/sessions/loiter.ndjson', ...fleet(5, 400, 'loiter') };
    case 'replay':
      return { command, file: values.file ?? 'var/sessions/loiter.ndjson', broker, speed: num(values.speed, undefined, 10) };
    default:
      throw new Error(`Unknown command: ${command ?? '(none)'}`);
  }
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

export async function main(argv: string[]): Promise<void> {
  const cmd = parseCli(argv);
  if (cmd.command === 'replay') {
    const sink = new MqttFleetSink({ url: cmd.broker });
    const n = await replay(readRecording(cmd.file), sink, { clock: new RealClock(), speed: cmd.speed });
    await sink.close();
    console.log(`replayed ${n} messages`);
    return;
  }
  const routes = loadRoutes(readJson(cmd.routes));
  const depot = depotBounds(readJson(cmd.geofence));
  const base = { count: cmd.count, hz: cmd.hz, durationMs: cmd.durationS * 1000, seed: cmd.seed, routes, scenarios: cmd.scenarios, depot };
  if (cmd.command === 'record') {
    const clock = new VirtualClock(Date.UTC(2026, 9, 4, 8));
    const sink = new NdjsonRecorderSink(cmd.out, clock);
    const stats = await runFleet({ ...base, clock, sink, seq: new MemorySeq() });
    console.log(`recorded ${stats.published} messages to ${cmd.out}`);
    return;
  }
  const sink = new MqttFleetSink({ url: cmd.broker });
  const ac = new AbortController();
  const stop = () => ac.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const stats = await runFleet({ ...base, clock: new RealClock(), sink, seq: new SeqAllocator(join(cmd.state, 'seq.json')), signal: ac.signal });
  await sink.close();
  console.log(JSON.stringify({ stopped: true, ...stats }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); },
  );
}
