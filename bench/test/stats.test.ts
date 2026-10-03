import { expect, test } from 'vitest';
import { percentile, summarize } from '../src/index.js';

const one100 = Array.from({ length: 100 }, (_, i) => i + 1);

test('nearest-rank percentiles on 1..100', () => {
  expect(percentile(one100, 50)).toBe(50);
  expect(percentile(one100, 95)).toBe(95);
  expect(percentile(one100, 99)).toBe(99);
  expect(percentile(one100, 100)).toBe(100);
});
test('an empty sample throws', () => {
  expect(() => percentile([], 50)).toThrow();
  expect(() => summarize([])).toThrow();
});
test('summarize sorts its input', () => {
  const s = summarize([5, 1, 3]);
  expect(s).toMatchObject({ n: 3, p50: 3, max: 5, mean: 3 });
});
