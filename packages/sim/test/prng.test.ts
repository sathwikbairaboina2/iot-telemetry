import { describe, expect, test } from 'vitest';
import { gaussian, mulberry32 } from '../src/index.js';

describe('prng', () => {
  test('mulberry32(42) is stable', () => {
    const r = mulberry32(42);
    expect([r(), r(), r()]).toMatchInlineSnapshot(`
      [
        0.6011037519201636,
        0.44829055899754167,
        0.8524657934904099,
      ]
    `);
  });
  test('same seed, same sequence, all in [0,1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  test('gaussian has mean 0 and sd 1', () => {
    const r = mulberry32(1);
    const xs = Array.from({ length: 10_000 }, () => gaussian(r));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(sd - 1)).toBeLessThan(0.05);
  });
});
