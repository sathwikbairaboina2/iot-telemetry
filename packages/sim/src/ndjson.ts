import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Telemetry } from '@iot-telemetry/schema';
import type { Clock } from './clock.js';
import type { TelemetrySink } from './fleet.js';

export interface RecordedMessage { publishAtMs: number; telemetry: Telemetry }

/** Writes one JSON line per published message, stamped with the clock time of the publish. */
export class NdjsonRecorderSink implements TelemetrySink {
  constructor(private readonly file: string, private readonly clock: Clock) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '');
  }
  async publish(t: Telemetry): Promise<void> {
    const line: RecordedMessage = { publishAtMs: this.clock.now(), telemetry: t };
    appendFileSync(this.file, JSON.stringify(line) + '\n');
  }
  async setOnline(): Promise<void> {}
  async close(): Promise<void> {}
}

export function readRecording(file: string): RecordedMessage[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as RecordedMessage);
}

/** Re-publishes a recording at `speed` times real time. Returns the number of messages published. */
export async function replay(messages: RecordedMessage[], sink: TelemetrySink, opts: { clock: Clock; speed: number }): Promise<number> {
  if (messages.length === 0) return 0;
  const base = messages[0]!.publishAtMs;
  const t0 = opts.clock.now();
  for (const m of messages) {
    await opts.clock.sleepUntil(t0 + (m.publishAtMs - base) / opts.speed);
    await sink.publish(m.telemetry);
  }
  return messages.length;
}
