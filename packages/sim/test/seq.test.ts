import { describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySeq, SeqAllocator } from '../src/index.js';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'seq-')), 'seq.json');

describe('MemorySeq', () => {
  test('counts from 0 per vehicle', () => {
    const s = new MemorySeq();
    expect([s.next('a'), s.next('a'), s.next('b'), s.next('a')]).toEqual([0, 1, 0, 2]);
  });
});

describe('SeqAllocator', () => {
  test('strictly increasing per vehicle, independent across vehicles', () => {
    const s = new SeqAllocator(tmpFile(), 10);
    const a = Array.from({ length: 25 }, () => s.next('veh-0001'));
    const b = Array.from({ length: 5 }, () => s.next('veh-0002'));
    for (let i = 1; i < a.length; i++) expect(a[i]!).toBeGreaterThan(a[i - 1]!);
    expect(b[0]).toBe(0);
    expect(a[0]).toBe(0);
  });
  test('a restart skips the rest of the reserved block', () => {
    const f = tmpFile();
    const s1 = new SeqAllocator(f, 10);
    for (let i = 0; i < 3; i++) s1.next('v');
    const s2 = new SeqAllocator(f, 10);
    expect(s2.next('v')).toBeGreaterThanOrEqual(10);
  });
  test('5 restarts of 7 calls each stay strictly increasing and the file stays valid JSON', () => {
    const f = tmpFile();
    const seen: number[] = [];
    for (let r = 0; r < 5; r++) {
      const s = new SeqAllocator(f, 10);
      for (let i = 0; i < 7; i++) {
        seen.push(s.next('v'));
        expect(() => JSON.parse(readFileSync(f, 'utf8'))).not.toThrow();
      }
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
  });
  test('a missing file starts at 0', () => {
    expect(new SeqAllocator(tmpFile()).next('v')).toBe(0);
  });
});
