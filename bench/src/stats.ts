/** Nearest-rank percentile of an ascending-sorted array. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) throw new Error('percentile of an empty sample');
  const rank = Math.max(1, Math.ceil((p / 100) * sortedAsc.length));
  return sortedAsc[Math.min(rank, sortedAsc.length) - 1]!;
}

export function summarize(samples: number[]): { n: number; p50: number; p95: number; p99: number; max: number; mean: number } {
  const s = [...samples].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length, p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99),
    max: s[s.length - 1]!, mean: sum / s.length,
  };
}
