import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Telemetry } from '@iot-telemetry/schema';

export interface Sink<T> { write(record: T): Promise<void> }
export interface QuarantineRecord { topic: string; receivedAt: string; reason: string; raw: unknown }

export class MemorySink<T> implements Sink<T> {
  readonly records: T[] = [];
  async write(record: T): Promise<void> { this.records.push(record); }
}

async function appendLine(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(value) + '\n');
}

/** `{root}/history/dt=YYYY-MM-DD/hour=HH.ndjson`, partitioned by the telemetry timestamp (UTC), like the Firehose layout. */
export class NdjsonHistorySink implements Sink<Telemetry> {
  constructor(private readonly root: string) {}
  write(t: Telemetry): Promise<void> {
    return appendLine(join(this.root, 'history', `dt=${t.ts.slice(0, 10)}`, `hour=${t.ts.slice(11, 13)}.ndjson`), t);
  }
}

/** `{root}/quarantine/dt=YYYY-MM-DD.ndjson`, partitioned by the time the message was received. */
export class NdjsonQuarantineSink implements Sink<QuarantineRecord> {
  constructor(private readonly root: string) {}
  write(r: QuarantineRecord): Promise<void> {
    return appendLine(join(this.root, 'quarantine', `dt=${r.receivedAt.slice(0, 10)}.ndjson`), r);
  }
}
