import type { EphemerisTrajectory } from '@/lib/types';
import {
  findTemporalInterval,
  resetCacheIfDataChanged,
  type TemporalLookupCache,
} from './temporalLookup';

export interface TrajectorySegment {
  startTime: string;
  endTime: string;
  startTimeMs: number;
  endTimeMs: number;
  pointTimesMs: number[];
  points: EphemerisTrajectory[];
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
const MERGE_GAP_MS = 36 * 60 * 60 * 1000; // 36h merges overlap/adjacent blocks

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

function segmentFromSortedPoints(points: EphemerisTrajectory[], pointTimesMs: number[]): TrajectorySegment {
  return {
    startTime: points[0].timestamp,
    endTime: points[points.length - 1].timestamp,
    startTimeMs: pointTimesMs[0],
    endTimeMs: pointTimesMs[pointTimesMs.length - 1],
    pointTimesMs,
    points,
  };
}

export function buildTrajectorySegment(points: EphemerisTrajectory[]): TrajectorySegment | null {
  const normalized = normalizeTrajectoryPoints(points);
  if (normalized.length === 0) return null;
  return segmentFromSortedPoints(normalized, normalized.map((point) => parseTimeMs(point.timestamp)));
}

function canMergeSegments(a: TrajectorySegment, b: TrajectorySegment): boolean {
  return !(a.endTimeMs + MERGE_GAP_MS < b.startTimeMs || b.endTimeMs + MERGE_GAP_MS < a.startTimeMs);
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
  return segmentFromSortedPoints(points, times);
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
): TrajectorySegment[] {
  const incoming = buildTrajectorySegment(incomingPoints);
  if (!incoming) return existing;

  let merged = incoming;
  const kept: TrajectorySegment[] = [];

  for (const segment of existing) {
    if (canMergeSegments(segment, incoming)) {
      merged = mergeSegments(segment, merged);
    } else {
      kept.push(segment);
    }
  }

  const compacted = compactMergeableSegments([...kept, merged]);
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
  return segmentFromSortedPoints(segment.points.slice(start, end), segment.pointTimesMs.slice(start, end));
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
  return segments.findIndex((segment) => timeMs >= segment.startTimeMs && timeMs <= segment.endTimeMs);
}

export function hasCoverageAtTime(segments: TrajectorySegment[], timeMs: number): boolean {
  return findSegmentIndexForTime(segments, timeMs) !== -1;
}

export function hasCoverageNearTime(
  segments: TrajectorySegment[],
  timeMs: number,
  toleranceMs: number
): boolean {
  return segments.some(
    (segment) => timeMs >= segment.startTimeMs - toleranceMs && timeMs <= segment.endTimeMs + toleranceMs
  );
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

    const startDistance = Math.abs(timeMs - segment.startTimeMs);
    if (startDistance < bestDistance) {
      bestDistance = startDistance;
      best = { position: segment.points[0].position, segmentIndex: i, pointIndex: 0 };
    }

    const endDistance = Math.abs(timeMs - segment.endTimeMs);
    if (endDistance < bestDistance) {
      bestDistance = endDistance;
      best = {
        position: segment.points[segment.points.length - 1].position,
        segmentIndex: i,
        pointIndex: segment.points.length - 1,
      };
    }
  }

  return best;
}

export function sampleTrajectoryAtTime(
  segments: TrajectorySegment[],
  timeMs: number,
  lookupCache?: TemporalLookupCache | null
): SampledTrajectoryPoint | null {
  if (segments.length === 0) return null;

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

