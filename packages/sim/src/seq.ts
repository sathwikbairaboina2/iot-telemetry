import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SeqSource { next(vehicleId: string): number }

export class MemorySeq implements SeqSource {
  private readonly counters = new Map<string, number>();
  next(vehicleId: string): number {
    const n = this.counters.get(vehicleId) ?? 0;
    this.counters.set(vehicleId, n + 1);
    return n;
  }
}

/**
 * Crash-safe sequence numbers (ADR 0006). The file holds, per vehicle, the number below which values may already have
 * been handed out. A new block is persisted (tmp file + rename) before its first number is used, so a restart resumes
 * at the reserved bound and never repeats a number. The rest of the old block is skipped, which leaves a gap.
 */
export class SeqAllocator implements SeqSource {
  private reserved: Record<string, number> = {};
  private readonly cursor = new Map<string, { next: number; limit: number }>();

  constructor(private readonly file: string, private readonly blockSize = 1000) {
    if (existsSync(file)) this.reserved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, number>;
  }

  next(vehicleId: string): number {
    let c = this.cursor.get(vehicleId);
    if (!c || c.next >= c.limit) {
      const start = this.reserved[vehicleId] ?? 0;
      c = { next: start, limit: start + this.blockSize };
      this.reserved[vehicleId] = c.limit;
      this.persist();
      this.cursor.set(vehicleId, c);
    }
    return c.next++;
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.reserved));
    renameSync(tmp, this.file);
  }
}
