import type { Telemetry } from '@iot-telemetry/schema';
import type { Clock } from './clock.js';
import { mulberry32 } from './prng.js';
import type { Route } from './routes.js';
import { TUNNEL_ID, TUNNEL_OFFLINE, loiterVehicle, tunnelVehicle } from './scenarios.js';
import type { SeqSource } from './seq.js';
import { routeVehicle, toTelemetry, type VehicleModel } from './vehicle.js';

export interface TelemetrySink {
  publish(t: Telemetry): Promise<void>;
  setOnline(vehicleId: string, online: boolean): Promise<void>;
}
export type ScenarioName = 'loiter' | 'tunnel';
export interface Depot { south: number; north: number; west: number; east: number }
export interface FleetOptions {
  count: number; hz: number; durationMs: number; seed: number; routes: Route[];
  scenarios: ScenarioName[]; depot: Depot;
  clock: Clock; sink: TelemetrySink; seq: SeqSource;
  /** Default true. false runs the tunnel vehicle without its outage (control run). */
  outages?: boolean;
  /** Stops a `durationMs: 0` run. */
  signal?: AbortSignal;
}
export interface FleetRunStats { published: number; buffered: number; flushed: number; ticks: number }

export const fleetVehicleId = (i: number): string => `veh-${String(i + 1).padStart(4, '0')}`;

export async function runFleet(opts: FleetOptions): Promise<FleetRunStats> {
  const { clock, sink, seq } = opts;
  const startMs = clock.now();
  const periodMs = 1000 / opts.hz;
  const rng = mulberry32(opts.seed);

  const vehicles: VehicleModel[] = [];
  for (let i = 0; i < opts.count; i++) {
    const route = opts.routes[i % opts.routes.length]!;
    const startOffsetM = rng() * route.lengthM;
    const baseSpeedKph = 30 + rng() * 30;
    vehicles.push(routeVehicle({
      id: fleetVehicleId(i), route, rng: mulberry32((opts.seed + 1) * 100003 + i), startMs, startOffsetM, baseSpeedKph,
    }));
  }
  if (opts.scenarios.includes('loiter')) vehicles.push(loiterVehicle(startMs, opts.depot));
  if (opts.scenarios.includes('tunnel')) vehicles.push(tunnelVehicle(startMs, opts.depot));
  vehicles.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const outagesOn = opts.outages !== false;
  const buffers = new Map<string, Telemetry[]>();
  const offline = new Map<string, boolean>();
  const stats: FleetRunStats = { published: 0, buffered: 0, flushed: 0, ticks: 0 };

  for (const v of vehicles) await sink.setOnline(v.id, true);

  const totalTicks = opts.durationMs > 0 ? Math.floor(opts.durationMs / periodMs) : Infinity;
  for (let k = 0; k < totalTicks; k++) {
    if (opts.signal?.aborted) break;
    const t = startMs + k * periodMs;
    await clock.sleepUntil(t);
    if (opts.signal?.aborted) break;
    stats.ticks++;
    const rel = t - startMs;
    for (const v of vehicles) {
      const isOffline = outagesOn && v.id === TUNNEL_ID && rel >= TUNNEL_OFFLINE.fromMs && rel < TUNNEL_OFFLINE.toMs;
      const wasOffline = offline.get(v.id) ?? false;
      if (isOffline && !wasOffline) await sink.setOnline(v.id, false);
      offline.set(v.id, isOffline);

      const msg = toTelemetry(v.id, seq.next(v.id), t, v.sample(t));
      if (isOffline) {
        const buf = buffers.get(v.id) ?? [];
        buf.push(msg);
        buffers.set(v.id, buf);
        stats.buffered++;
        continue;
      }
      if (wasOffline) {
        await sink.setOnline(v.id, true);
        const buf = buffers.get(v.id) ?? [];
        buffers.set(v.id, []);
        for (const old of buf) {
          await sink.publish(old);
          stats.published++;
          stats.flushed++;
        }
      }
      await sink.publish(msg);
      stats.published++;
    }
  }
  return stats;
}

