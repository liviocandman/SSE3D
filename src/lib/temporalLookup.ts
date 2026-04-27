/**
 * temporalLookup
 *
 * Phase 3 — Make time sampling efficient.
 *
 * Shared utility for resolving the adjacent sample indices and interpolation
 * fraction (alpha) for a given absolute timestamp inside a sorted numeric
 * timestamp array.
 *
 * Design goals (from the implementation plan):
 *  - No linear .find() / .findIndex() scans per frame on long arrays.
 *  - Binary search as the baseline lookup strategy.
 *  - Optional monotonic-index caching optimised for forward playback.
 *  - Safe fallback to binary search for reverse playback and arbitrary jumps.
 *  - Timezone-safe: all inputs and outputs are UTC milliseconds.
 *
 * Contract:
 *  input:  timestampMs   — absolute UTC epoch ms
 *  output: { leftIndex, rightIndex, alpha }
 *           alpha = 0.0 → exactly at left sample
 *           alpha = 1.0 → exactly at right sample
 *
 * Usage:
 *   const cache = createTemporalLookupCache();
 *   const result = findTemporalInterval(pointTimesMs, timestampMs, cache);
 *   if (result) {
 *     const pos = lerp(points[result.leftIndex], points[result.rightIndex], result.alpha);
 *   }
 */

/** Result of a temporal interval lookup. */
export interface TemporalInterval {
  /** Index of the sample at or just before timestampMs */
  leftIndex: number;
  /** Index of the sample at or just after timestampMs (leftIndex + 1) */
  rightIndex: number;
  /** Linear interpolation weight: 0.0 at left sample, 1.0 at right sample */
  alpha: number;
}

/**
 * Mutable cache state for monotonic forward-playback optimisation.
 * Create one per trajectory consumer and pass it into findTemporalInterval().
 * Reset or discard when the underlying data array changes.
 */
export interface TemporalLookupCache {
  /** Last known left index. -1 means uninitialised. */
  lastIndex: number;
  /** The timestamp that produced lastIndex. */
  lastTimestampMs: number;
  /** The exact data array currently bound to this cache. */
  lastDataRef: number[] | null;
}

/**
 * Factory for a fresh cache state.
 */
export function createTemporalLookupCache(): TemporalLookupCache {
  return { lastIndex: -1, lastTimestampMs: -1, lastDataRef: null };
}

/**
 * Binary search for the largest index i such that pointTimesMs[i] <= timestampMs.
 * Returns -1 if timestampMs is before all samples.
 * Returns pointTimesMs.length - 1 if timestampMs is after all samples.
 *
 * Internal helper — use findTemporalInterval() for the public API.
 */
function binarySearchLeft(pointTimesMs: number[], timestampMs: number): number {
  let lo = 0;
  let hi = pointTimesMs.length - 1;
  let result = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (pointTimesMs[mid] <= timestampMs) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result;
}

/**
 * Find the temporal interval enclosing `timestampMs` in a sorted ms array.
 *
 * @param pointTimesMs  Sorted (ascending) array of UTC epoch milliseconds.
 * @param timestampMs   Query time in UTC epoch milliseconds.
 * @param cache         Optional mutable cache for monotonic playback optimisation.
 *                      Pass undefined / null to always use binary search.
 * @returns TemporalInterval or null if the array has fewer than 2 samples or
 *          timestampMs falls outside the covered range.
 */
export function findTemporalInterval(
  pointTimesMs: number[],
  timestampMs: number,
  cache?: TemporalLookupCache | null
): TemporalInterval | null {
  const len = pointTimesMs.length;
  if (len < 2) return null;

  const first = pointTimesMs[0];
  const last = pointTimesMs[len - 1];

  if (timestampMs < first || timestampMs > last) return null;

  if (cache && cache.lastDataRef !== pointTimesMs) {
    resetCacheIfDataChanged(cache, pointTimesMs);
  }

  let leftIndex: number;

  // Monotonic cache probe — valid only when time is moving forward and the
  // previous answer is still a useful starting point.
  if (
    cache &&
    cache.lastIndex >= 0 &&
    timestampMs >= cache.lastTimestampMs
  ) {
    // Walk forward from the cached position
    leftIndex = cache.lastIndex;
    while (leftIndex < len - 2 && pointTimesMs[leftIndex + 1] <= timestampMs) {
      leftIndex++;
    }
    // Validate — if the probe overshot (e.g. after a data change), fall back
    if (pointTimesMs[leftIndex] > timestampMs) {
      leftIndex = binarySearchLeft(pointTimesMs, timestampMs);
    }
  } else {
    // Full binary search
    leftIndex = binarySearchLeft(pointTimesMs, timestampMs);
  }

  // When the timestamp lands exactly on an internal sample, prefer closing the
  // previous interval with alpha = 1 instead of opening the next one with alpha = 0.
  if (leftIndex > 0 && pointTimesMs[leftIndex] === timestampMs) {
    leftIndex--;
  }

  // Clamp to a valid pair
  leftIndex = Math.max(0, Math.min(leftIndex, len - 2));

  // Update cache
  if (cache) {
    cache.lastIndex = leftIndex;
    cache.lastTimestampMs = timestampMs;
    cache.lastDataRef = pointTimesMs;
  }

  const rightIndex = leftIndex + 1;
  const t0 = pointTimesMs[leftIndex];
  const t1 = pointTimesMs[rightIndex];
  const span = t1 - t0;
  const alpha = span > 0 ? Math.max(0, Math.min(1, (timestampMs - t0) / span)) : 0;

  return { leftIndex, rightIndex, alpha };
}

/**
 * Convenience wrapper: reset a cache whenever the underlying data identity
 * changes. Returns the same cache object (mutated) for easy use in useRef.
 *
 * Usage:
 *   const cache = useRef(createTemporalLookupCache());
 *   resetCacheIfDataChanged(cache.current, pointTimesMs);
 */
export function resetCacheIfDataChanged(
  cache: TemporalLookupCache,
  pointTimesMs: number[]
): void {
  if (cache.lastDataRef !== pointTimesMs) {
    // Data changed - full reset to force binary search next call.
    cache.lastIndex = -1;
    cache.lastTimestampMs = -1;
    cache.lastDataRef = pointTimesMs;
  }
}
