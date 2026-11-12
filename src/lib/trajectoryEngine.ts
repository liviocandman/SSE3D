import type { EphemerisPosition, EphemerisTrajectory } from '@/lib/types';
import {
  findTemporalInterval,
  resetCacheIfDataChanged,
  type TemporalLookupCache,
} from './temporalLookup';
import { getMaxInterpolationGapMs, TRAJECTORY_CADENCE_GAP_FACTOR } from './trajectoryPolicy';

export interface TrajectorySegment {
  startTime: string;
  endTime: string;
  startTimeMs: number;
  endTimeMs: number;
  pointTimesMs: number[];
  points: EphemerisTrajectory[];
  /** Preserve the continuity bound through merges and retention slices. */
  maxGapMs: number;
}

export interface SampledTrajectoryPoint {
  position: { x: number; y: number; z: number };
  segmentIndex: number;
  pointIndex: number;
  clamped: boolean;
  status: 'covered' | 'gap' | 'before_all' | 'after_all';
}

export interface BufferPlan {
  pause: boolean;
  fetchDates: string[];
}

import { parseTimestampMs } from './utils';

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMESTAMP_ROUNDING_MS = 2;

// Retain scientific samples, not decimated approximations. These bounds also
// apply when adjacent downloads have compacted into a single long segment.
export const MAX_TRAJECTORY_POINTS_PER_BODY = 4096;
export const TRAJECTORY_RETENTION_RADIUS_MS = 180 * DAY_MS;

export interface TrajectoryRetention {
  maxPoints: number;
  radiusMs: number;
}

const DEFAULT_RETENTION: TrajectoryRetention = {
  maxPoints: MAX_TRAJECTORY_POINTS_PER_BODY,
  radiusMs: TRAJECTORY_RETENTION_RADIUS_MS,
};

function parseTimeMs(timestamp: string): number {
  return parseTimestampMs(timestamp);
}

function toDateStringUTC(ms: number): string {
  // Return early if invalid
  if (isNaN(ms) || ms === 0) return '';
  return new Date(ms).toISOString().split('T')[0];
}

export function normalizeTrajectoryPoints(points: EphemerisTrajectory[]): EphemerisTrajectory[] {
  const unique = new Map<number, EphemerisTrajectory>();
  let alreadySorted = true;
  let previousTime = -Infinity;
  for (const point of points) {
    const time = parseTimeMs(point.timestamp);
    if (!Number.isFinite(time) || !Number.isFinite(point.position.x)
      || !Number.isFinite(point.position.y) || !Number.isFinite(point.position.z)) {
      alreadySorted = false;
      continue;
    }
    if (time <= previousTime) alreadySorted = false;
    previousTime = time;
    unique.set(time, point);
  }
  if (alreadySorted) return points;
  return Array.from(unique.entries()).sort(([a], [b]) => a - b).map(([, point]) => point);
}

function segmentFromSortedPoints(
  points: EphemerisTrajectory[], pointTimesMs: number[], maxGapMs: number,
): TrajectorySegment {
  return {
    startTime: points[0].timestamp,
    endTime: points[points.length - 1].timestamp,
    startTimeMs: pointTimesMs[0],
    endTimeMs: pointTimesMs[pointTimesMs.length - 1],
    pointTimesMs,
    points,
    maxGapMs,
  };
}

export function buildTrajectorySegment(points: EphemerisTrajectory[], bodyId?: string): TrajectorySegment | null {
  const normalized = normalizeTrajectoryPoints(points);
  if (normalized.length === 0) return null;
  const times = normalized.map((point) => parseTimeMs(point.timestamp));
  const intervals = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
  // The lower median tolerates timestamp rounding without allowing a few large
  // holes to redefine the sample cadence. Body policy also bounds sparse inputs.
  const cadenceMs = intervals[Math.floor((intervals.length - 1) / 2)];
  const maxGapMs = Math.min(
    cadenceMs === undefined ? 0 : cadenceMs * TRAJECTORY_CADENCE_GAP_FACTOR + TIMESTAMP_ROUNDING_MS,
    bodyId ? getMaxInterpolationGapMs(bodyId) + TIMESTAMP_ROUNDING_MS : Infinity,
  );
  return segmentFromSortedPoints(normalized, times, maxGapMs);
}

function splitSegmentAtGaps(segment: TrajectorySegment): TrajectorySegment[] {
  const result: TrajectorySegment[] = [];
  let start = 0;
  for (let index = 1; index < segment.points.length; index++) {
    if (segment.pointTimesMs[index] - segment.pointTimesMs[index - 1] > segment.maxGapMs) {
      result.push(sliceSegment(segment, start, index));
      start = index;
    }
  }
  result.push(sliceSegment(segment, start, segment.points.length));
  return result;
}

/** Build continuous runs, including when one download contains missing samples. */
export function buildTrajectorySegments(points: EphemerisTrajectory[], bodyId?: string): TrajectorySegment[] {
  const segment = buildTrajectorySegment(points, bodyId);
  return segment ? splitSegmentAtGaps(segment) : [];
}

function canMergeSegments(a: TrajectorySegment, b: TrajectorySegment): boolean {
  const [left, right] = a.startTimeMs <= b.startTimeMs ? [a, b] : [b, a];
  if (left.endTimeMs >= right.startTimeMs) return true;
  const leftTimes = left.pointTimesMs;
  const rightTimes = right.pointTimesMs;
  const leftCadence = leftTimes.length > 1 ? leftTimes.at(-1)! - leftTimes.at(-2)! : 0;
  const rightCadence = rightTimes.length > 1 ? rightTimes[1] - rightTimes[0] : 0;
  const boundaryLimit = Math.min(
    leftCadence * TRAJECTORY_CADENCE_GAP_FACTOR + TIMESTAMP_ROUNDING_MS,
    rightCadence * TRAJECTORY_CADENCE_GAP_FACTOR + TIMESTAMP_ROUNDING_MS,
    left.maxGapMs,
    right.maxGapMs,
  );
  return right.startTimeMs - left.endTimeMs <= boundaryLimit;
}

function samePoint(a: EphemerisTrajectory, b: EphemerisTrajectory): boolean {
  return a === b || (a.position.x === b.position.x && a.position.y === b.position.y
    && a.position.z === b.position.z && a.velocity?.x === b.velocity?.x
    && a.velocity?.y === b.velocity?.y && a.velocity?.z === b.velocity?.z);
}

function mergeSegments(a: TrajectorySegment, b: TrajectorySegment): TrajectorySegment {
  const points: EphemerisTrajectory[] = [];
  const times: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.points.length || j < b.points.length) {
    if (j === b.points.length || (i < a.points.length && a.pointTimesMs[i] < b.pointTimesMs[j])) {
      points.push(a.points[i]);
      times.push(a.pointTimesMs[i++]);
    } else if (i === a.points.length || b.pointTimesMs[j] < a.pointTimesMs[i]) {
      points.push(b.points[j]);
      times.push(b.pointTimesMs[j++]);
    } else {
      // New downloads are authoritative, but reuse identical scientific samples.
      points.push(samePoint(a.points[i], b.points[j]) ? a.points[i] : b.points[j]);
      times.push(a.pointTimesMs[i++]);
      j++;
    }
  }
  if (points.length === a.points.length && points.every((point, index) => point === a.points[index])) return a;
  // Each input is continuous; overlap or a validated boundary preserves that
  // coverage even when the two downloads have different sample cadences.
  return segmentFromSortedPoints(points, times, Math.max(a.maxGapMs, b.maxGapMs));
}

function sortSegments(segments: TrajectorySegment[]): TrajectorySegment[] {
  return [...segments].sort((a, b) => a.startTimeMs - b.startTimeMs);
}

function compactMergeableSegments(segments: TrajectorySegment[]): TrajectorySegment[] {
  if (segments.length <= 1) return segments;
  const sorted = sortSegments(segments);
  const compacted: TrajectorySegment[] = [];

  for (const segment of sorted) {
    const last = compacted[compacted.length - 1];
    if (!last) {
      compacted.push(segment);
      continue;
    }
    if (canMergeSegments(last, segment)) {
      compacted[compacted.length - 1] = mergeSegments(last, segment);
    } else {
      compacted.push(segment);
    }
  }

  return compacted;
}

function trimSegmentsAroundTime(
  segments: TrajectorySegment[],
  anchorTimeMs: number,
  maxSegments: number
): TrajectorySegment[] {
  if (segments.length <= maxSegments) return segments;

  let anchorIndex = segments.findIndex(
    (segment) => anchorTimeMs >= segment.startTimeMs && anchorTimeMs <= segment.endTimeMs
  );

  if (anchorIndex === -1) {
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const distance =
        anchorTimeMs < segment.startTimeMs
          ? segment.startTimeMs - anchorTimeMs
          : anchorTimeMs > segment.endTimeMs
            ? anchorTimeMs - segment.endTimeMs
            : 0;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        anchorIndex = i;
      }
    }
  }

  const halfWindow = Math.floor((maxSegments - 1) / 2);
  let start = Math.max(0, anchorIndex - halfWindow);
  if (start + maxSegments > segments.length) {
    start = segments.length - maxSegments;
  }
  return segments.slice(start, start + maxSegments);
}

export function upsertTrajectorySegments(
  existing: TrajectorySegment[],
  incomingPoints: EphemerisTrajectory[],
  anchorTimeMs: number,
  maxSegments = 3,
  retention: TrajectoryRetention = DEFAULT_RETENTION,
  bodyId?: string,
): TrajectorySegment[] {
  const incoming = buildTrajectorySegments(incomingPoints, bodyId);
  if (!incoming.length) return existing;

  let compacted = existing.flatMap(splitSegmentAtGaps);
  for (const part of incoming) {
    let merged = part;
    const kept: TrajectorySegment[] = [];
    for (const segment of compacted) {
      if (canMergeSegments(segment, merged)) {
        merged = mergeSegments(segment, merged);
      } else {
        kept.push(segment);
      }
    }
    compacted = compactMergeableSegments([...kept, merged]);
  }
  const limited = retainTrajectoryWindow(
    trimSegmentsAroundTime(compacted, anchorTimeMs, Math.max(1, maxSegments)),
    anchorTimeMs,
    retention,
  );
  // Repeated downloads may include samples already evicted by retention. Reuse
  // the retained window when none of its scientific values actually changed.
  for (let i = 0; i < limited.length; i++) {
    const candidate = limited[i];
    const previous = existing.find((segment) => segment.startTimeMs === candidate.startTimeMs
      && segment.endTimeMs === candidate.endTimeMs && segment.points.length === candidate.points.length);
    if (previous && previous !== candidate && candidate.points.every((point, index) =>
      candidate.pointTimesMs[index] === previous.pointTimesMs[index] && samePoint(point, previous.points[index]))) {
      limited[i] = previous;
    }
  }
  return limited.length === existing.length && limited.every((segment, index) => segment === existing[index])
    ? existing
    : limited;
}

function lowerBound(times: number[], target: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function sliceSegment(segment: TrajectorySegment, start: number, end: number): TrajectorySegment {
  if (start === 0 && end === segment.points.length) return segment;
  return segmentFromSortedPoints(
    segment.points.slice(start, end), segment.pointTimesMs.slice(start, end), segment.maxGapMs,
  );
}

function retainTrajectoryWindow(
  segments: TrajectorySegment[],
  anchorTimeMs: number,
  { maxPoints, radiusMs }: TrajectoryRetention,
): TrajectorySegment[] {
  if (segments.length === 0) return segments;
  const radius = Math.max(0, radiusMs);
  const budget = Math.max(2, Math.floor(maxPoints));
  let anchor = Number.isFinite(anchorTimeMs) ? anchorTimeMs : segments[0].startTimeMs;

  // Keep a bounded nearest fallback while a distant seek is still loading.
  if (!segments.some((segment) => segment.endTimeMs >= anchor - radius && segment.startTimeMs <= anchor + radius)) {
    let nearest = segments[0].startTimeMs;
    for (const segment of segments) {
      for (const endpoint of [segment.startTimeMs, segment.endTimeMs]) {
        if (Math.abs(endpoint - anchor) < Math.abs(nearest - anchor)) nearest = endpoint;
      }
    }
    anchor = nearest;
  }

  const clipped: TrajectorySegment[] = [];
  for (const segment of segments) {
    if (segment.endTimeMs < anchor - radius || segment.startTimeMs > anchor + radius) continue;
    // One original sample on either side preserves interpolation at the window edges.
    const start = Math.max(0, lowerBound(segment.pointTimesMs, anchor - radius) - 1);
    const end = Math.min(segment.points.length, lowerBound(segment.pointTimesMs, anchor + radius) + 1);
    clipped.push(sliceSegment(segment, start, end));
  }

  const total = clipped.reduce((sum, segment) => sum + segment.points.length, 0);
  if (total <= budget) return clipped;

  let pivot = 0;
  for (const segment of clipped) pivot += lowerBound(segment.pointTimesMs, anchor);
  // Select a contiguous sample window around the anchor, never decimating it.
  const first = Math.max(0, Math.min(pivot - Math.floor(budget / 2), total - budget));
  const last = first + budget;
  const result: TrajectorySegment[] = [];
  let offset = 0;
  for (const segment of clipped) {
    const start = Math.max(0, first - offset);
    const end = Math.min(segment.points.length, last - offset);
    if (start < end) result.push(sliceSegment(segment, start, end));
    offset += segment.points.length;
  }
  return result;
}

export function flattenTrajectorySegments(segments: TrajectorySegment[]): EphemerisTrajectory[] {
  // Upserted segments are already sorted, normalized, and disjoint.
  if (segments.length === 1) return segments[0].points;
  return segments.flatMap((segment) => segment.points);
}

export function findSegmentIndexForTime(
  segments: TrajectorySegment[],
  timeMs: number
): number {
  return segments.findIndex((segment) => {
    if (timeMs < segment.startTimeMs || timeMs > segment.endTimeMs || !Number.isFinite(timeMs)) return false;
    const right = lowerBound(segment.pointTimesMs, timeMs);
    return segment.pointTimesMs[right] === timeMs || (right > 0 && right < segment.pointTimesMs.length
      && segment.pointTimesMs[right] - segment.pointTimesMs[right - 1] <= segment.maxGapMs);
  });
}

export function hasCoverageAtTime(segments: TrajectorySegment[], timeMs: number): boolean {
  return findSegmentIndexForTime(segments, timeMs) !== -1;
}

export function hasCoverageNearTime(
  segments: TrajectorySegment[],
  timeMs: number,
  toleranceMs: number
): boolean {
  if (hasCoverageAtTime(segments, timeMs)) return true;
  if (!segments.length) return false;
  // Fetch tolerance applies only beyond the outer buffer edges. Expanding each
  // run would hide genuine internal gaps, especially for rapid moons.
  const start = segments[0].startTimeMs;
  const end = segments[segments.length - 1].endTimeMs;
  return (timeMs < start && timeMs >= start - toleranceMs)
    || (timeMs > end && timeMs <= end + toleranceMs);
}


function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

function interpolateHermite(
  p1: EphemerisTrajectory,
  p2: EphemerisTrajectory,
  alpha: number,
  deltaSeconds: number
): { x: number; y: number; z: number } {
  const v1 = p1.velocity;
  const v2 = p2.velocity;
  if (!v1 || !v2) {
    return {
      x: lerp(p1.position.x, p2.position.x, alpha),
      y: lerp(p1.position.y, p2.position.y, alpha),
      z: lerp(p1.position.z, p2.position.z, alpha),
    };
  }

  const a2 = alpha * alpha;
  const a3 = a2 * alpha;

  const h00 = 2 * a3 - 3 * a2 + 1;
  const h10 = a3 - 2 * a2 + alpha;
  const h01 = -2 * a3 + 3 * a2;
  const h11 = a3 - a2;

  const m0x = v1.x * deltaSeconds;
  const m0y = v1.y * deltaSeconds;
  const m0z = v1.z * deltaSeconds;
  const m1x = v2.x * deltaSeconds;
  const m1y = v2.y * deltaSeconds;
  const m1z = v2.z * deltaSeconds;

  const result = {
    x: h00 * p1.position.x + h10 * m0x + h01 * p2.position.x + h11 * m1x,
    y: h00 * p1.position.y + h10 * m0y + h01 * p2.position.y + h11 * m1y,
    z: h00 * p1.position.z + h10 * m0z + h01 * p2.position.z + h11 * m1z,
  };

  // Safety Sanitization: If any component is not a finite number (NaN, Infinity), 
  // fallback to base position to prevent engine "explosion".
  if (!Number.isFinite(result.x) || !Number.isFinite(result.y) || !Number.isFinite(result.z)) {
    return { x: p1.position.x, y: p1.position.y, z: p1.position.z };
  }

  return result;
}

function clampToNearestGapEndpoint(
  segments: TrajectorySegment[],
  timeMs: number
): { position: { x: number; y: number; z: number }; segmentIndex: number; pointIndex: number } {
  let bestDistance = Number.POSITIVE_INFINITY;
  let best = {
    position: segments[0].points[0].position,
    segmentIndex: 0,
    pointIndex: 0,
  };

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const right = lowerBound(segment.pointTimesMs, timeMs);
    for (const pointIndex of [right - 1, right]) {
      if (pointIndex < 0 || pointIndex >= segment.points.length) continue;
      const distance = Math.abs(timeMs - segment.pointTimesMs[pointIndex]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { position: segment.points[pointIndex].position, segmentIndex: i, pointIndex };
      }
    }
  }

  return best;
}

export function sampleTrajectoryAtTime(
  segments: TrajectorySegment[],
  timeMs: number,
  lookupCache?: TemporalLookupCache | null
): SampledTrajectoryPoint | null {
  if (segments.length === 0 || !Number.isFinite(timeMs)) return null;

  const first = segments[0];
  const last = segments[segments.length - 1];

  if (timeMs <= first.startTimeMs) {
    return {
      position: first.points[0].position,
      segmentIndex: 0,
      pointIndex: 0,
      clamped: true,
      status: 'before_all',
    };
  }

  if (timeMs >= last.endTimeMs) {
    return {
      position: last.points[last.points.length - 1].position,
      segmentIndex: segments.length - 1,
      pointIndex: last.points.length - 1,
      clamped: true,
      status: 'after_all',
    };
  }

  const segmentIndex = findSegmentIndexForTime(segments, timeMs);
  if (segmentIndex === -1) {
    const nearest = clampToNearestGapEndpoint(segments, timeMs);
    return {
      position: nearest.position,
      segmentIndex: nearest.segmentIndex,
      pointIndex: nearest.pointIndex,
      clamped: true,
      status: 'gap',
    };
  }

  const segment = segments[segmentIndex];
  const { points, pointTimesMs } = segment;
  if (lookupCache) {
    resetCacheIfDataChanged(lookupCache, pointTimesMs);
  }
  if (points.length === 1) {
    return {
      position: points[0].position,
      segmentIndex,
      pointIndex: 0,
      clamped: true,
      status: 'covered',
    };
  }

  if (timeMs <= pointTimesMs[0]) {
    return {
      position: points[0].position,
      segmentIndex,
      pointIndex: 0,
      clamped: true,
      status: 'covered',
    };
  }

  const lastPointIndex = points.length - 1;
  if (timeMs >= pointTimesMs[lastPointIndex]) {
    return {
      position: points[lastPointIndex].position,
      segmentIndex,
      pointIndex: lastPointIndex,
      clamped: true,
      status: 'covered',
    };
  }

  const result = findTemporalInterval(pointTimesMs, timeMs, lookupCache);
  if (!result) {
    return {
      position: points[0].position,
      segmentIndex,
      pointIndex: 0,
      clamped: true,
      status: 'covered',
    };
  }

  const { leftIndex, alpha } = result;
  const p1 = points[leftIndex];
  const p2 = points[leftIndex + 1];
  const t1 = pointTimesMs[leftIndex];
  const t2 = pointTimesMs[leftIndex + 1];
  const spanMs = t2 - t1;

  if (spanMs <= 0 || alpha <= 0) {
    return {
      position: p1.position,
      segmentIndex,
      pointIndex: leftIndex,
      clamped: true,
      status: 'covered',
    };
  }

  const interpolated = interpolateHermite(p1, p2, alpha, spanMs / 1000);
  return {
    position: interpolated,
    segmentIndex,
    pointIndex: leftIndex,
    clamped: false,
    status: 'covered',
  };
}

/**
 * UI telemetry uses the same position interpolation as the scene, with its
 * derivative in km/s. Uncovered instants have no telemetry, even while the
 * renderer holds a nearby endpoint waiting for another block.
 */
export function sampleTrajectoryStateAtTime(
  segments: TrajectorySegment[],
  timeMs: number,
): { position: EphemerisPosition; velocity?: EphemerisPosition } | null {
  if (!Number.isFinite(timeMs) || !hasCoverageAtTime(segments, timeMs)) return null;
  const sample = sampleTrajectoryAtTime(segments, timeMs);
  if (!sample) return null;

  const segment = segments[sample.segmentIndex];
  const point = segment.points[sample.pointIndex];
  if (sample.clamped) return { position: sample.position, velocity: point.velocity };

  const next = segment.points[sample.pointIndex + 1];
  const startMs = segment.pointTimesMs[sample.pointIndex];
  const deltaSeconds = (segment.pointTimesMs[sample.pointIndex + 1] - startMs) / 1000;
  const alpha = (timeMs - startMs) / (deltaSeconds * 1000);
  const a2 = alpha * alpha;
  const velocity: EphemerisPosition = { x: 0, y: 0, z: 0 };
  for (const axis of ['x', 'y', 'z'] as const) {
    velocity[axis] = point.velocity && next.velocity
      ? ((6 * a2 - 6 * alpha) * point.position[axis]
        + (-6 * a2 + 6 * alpha) * next.position[axis]) / deltaSeconds
        + (3 * a2 - 4 * alpha + 1) * point.velocity[axis]
        + (3 * a2 - 2 * alpha) * next.velocity[axis]
      : (next.position[axis] - point.position[axis]) / deltaSeconds;
  }

  return {
    position: sample.position,
    velocity: Object.values(velocity).every(Number.isFinite) ? velocity : undefined,
  };
}

export function computeBufferPlan({
  segments,
  timeMs,
  thresholdDays,
  fetchSpanDays,
  timeMultiplier,
  currentDate,
}: {
  segments: TrajectorySegment[];
  timeMs: number;
  thresholdDays: number;
  fetchSpanDays: number;
  timeMultiplier: number;
  currentDate: string;
}): BufferPlan {
  if (segments.length === 0) {
    return { pause: false, fetchDates: [currentDate] };
  }

  const thresholdMs = thresholdDays * DAY_MS;
  const containingIndex = findSegmentIndexForTime(segments, timeMs);

  if (containingIndex === -1) {
    return { pause: true, fetchDates: [currentDate] };
  }

  const segment = segments[containingIndex];
  const dates = new Set<string>();

  if (timeMultiplier >= 0 && timeMs > segment.endTimeMs - thresholdMs) {
    dates.add(toDateStringUTC(segment.endTimeMs + DAY_MS));
  }

  if (timeMultiplier <= 0 && timeMs < segment.startTimeMs + thresholdMs) {
    dates.add(toDateStringUTC(segment.startTimeMs - fetchSpanDays * DAY_MS));
  }

  return { pause: false, fetchDates: Array.from(dates) };
}

