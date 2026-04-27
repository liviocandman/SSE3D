import { describe, it, expect } from 'vitest';
import {
  findTemporalInterval,
  createTemporalLookupCache,
  resetCacheIfDataChanged,
  type TemporalInterval,
} from './temporalLookup';

// Helpers
function makeTimes(start: number, count: number, stepMs: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i * stepMs);
}

describe('findTemporalInterval', () => {
  const T0 = 1000;
  const STEP = 100;

  it('returns null for fewer than 2 samples', () => {
    expect(findTemporalInterval([], 1000)).toBeNull();
    expect(findTemporalInterval([1000], 1000)).toBeNull();
  });

  it('returns null when timestamp is before the first sample', () => {
    const times = makeTimes(T0, 5, STEP);
    expect(findTemporalInterval(times, T0 - 1)).toBeNull();
  });

  it('returns null when timestamp is after the last sample', () => {
    const times = makeTimes(T0, 5, STEP);
    expect(findTemporalInterval(times, T0 + 5 * STEP)).toBeNull();
  });

  it('closes the previous interval for exact internal samples', () => {
    const times = makeTimes(T0, 5, STEP);
    const result = findTemporalInterval(times, T0 + STEP) as TemporalInterval;
    expect(result).not.toBeNull();
    expect(result.leftIndex).toBe(0);
    expect(result.rightIndex).toBe(1);
    expect(result.alpha).toBeCloseTo(1);
  });

  it('returns alpha=1 for timestamp exactly at the right sample', () => {
    const times = makeTimes(T0, 5, STEP);
    const result = findTemporalInterval(times, T0 + 2 * STEP) as TemporalInterval;
    expect(result).not.toBeNull();
    expect(result.leftIndex).toBe(1);
    expect(result.rightIndex).toBe(2);
    expect(result.alpha).toBeCloseTo(1);
  });

  it('returns alpha=0.5 for midpoint between two samples', () => {
    const times = [0, 1000, 2000];
    const result = findTemporalInterval(times, 500) as TemporalInterval;
    expect(result).not.toBeNull();
    expect(result.leftIndex).toBe(0);
    expect(result.rightIndex).toBe(1);
    expect(result.alpha).toBeCloseTo(0.5);
  });

  it('handles large arrays efficiently (log N, no linear scan)', () => {
    // 100_000 samples — this should still be instant (binary search)
    const large = makeTimes(0, 100_000, 1000);
    const target = 50_000_000 + 333; // near the middle
    const result = findTemporalInterval(large, target);
    expect(result).not.toBeNull();
    expect(result!.alpha).toBeGreaterThan(0);
    expect(result!.alpha).toBeLessThan(1);
  });

  it('alpha is always clamped to [0, 1]', () => {
    // Equal timestamps (degenerate segment)
    const times = [1000, 1000, 2000];
    const result = findTemporalInterval(times, 1000);
    if (result) {
      expect(result.alpha).toBeGreaterThanOrEqual(0);
      expect(result.alpha).toBeLessThanOrEqual(1);
    }
  });
});

describe('findTemporalInterval — monotonic cache', () => {
  const T0 = 0;
  const STEP = 500;
  const COUNT = 200;

  it('returns the same result with and without a cache', () => {
    const times = makeTimes(T0, COUNT, STEP);
    const target = T0 + 55 * STEP + 123;

    const withoutCache = findTemporalInterval(times, target);
    const cache = createTemporalLookupCache();
    const withCache = findTemporalInterval(times, target, cache);

    expect(withCache).toEqual(withoutCache);
  });

  it('cache accelerates forward playback: walks without full binary search', () => {
    const times = makeTimes(T0, COUNT, STEP);
    const cache = createTemporalLookupCache();

    // Simulate forward playback: advancing through time monotonically
    let prevLeft = -1;
    for (let i = 10; i < COUNT - 1; i++) {
      const t = T0 + i * STEP + STEP / 3;
      const result = findTemporalInterval(times, t, cache) as TemporalInterval;
      expect(result).not.toBeNull();
      expect(result.leftIndex).toBeGreaterThanOrEqual(prevLeft);
      prevLeft = result.leftIndex;
    }
  });

  it('cache falls back to binary search safely on non-monotonic jumps', () => {
    const times = makeTimes(T0, COUNT, STEP);
    const cache = createTemporalLookupCache();

    // Prime the cache at a high index
    findTemporalInterval(times, T0 + 150 * STEP, cache);

    // Jump back in time — should still produce the correct result
    const target = T0 + 10 * STEP + STEP / 2;
    const result = findTemporalInterval(times, target, cache) as TemporalInterval;
    const expected = findTemporalInterval(times, target) as TemporalInterval;

    expect(result).not.toBeNull();
    expect(result.leftIndex).toBe(expected.leftIndex);
    expect(result.alpha).toBeCloseTo(expected.alpha);
  });
});

describe('resetCacheIfDataChanged', () => {
  it('resets cache when the data array identity changes', () => {
    const times = makeTimes(0, 100, 1000);
    const cache = createTemporalLookupCache();
    findTemporalInterval(times, 50_000, cache);
    expect(cache.lastIndex).toBeGreaterThan(-1);

    const newTimes = makeTimes(0, 50, 1000);
    resetCacheIfDataChanged(cache, newTimes);

    expect(cache.lastIndex).toBe(-1);
    expect(cache.lastDataRef).toBe(newTimes);
  });
});
