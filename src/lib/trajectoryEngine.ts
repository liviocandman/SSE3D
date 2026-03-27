import type { EphemerisTrajectory } from '@/lib/types';

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

const DAY_MS = 24 * 60 * 60 * 1000;
const MERGE_GAP_MS = 36 * 60 * 60 * 1000; // 36h merges overlap/adjacent blocks

function parseTimeMs(timestamp: string): number {
  return new Date(timestamp).getTime();
}

function toDateStringUTC(ms: number): string {
  return new Date(ms).toISOString().split('T')[0];
}

export function normalizeTrajectoryPoints(points: EphemerisTrajectory[]): EphemerisTrajectory[] {
  const unique = new Map<string, EphemerisTrajectory>();
  for (const point of points) {
    unique.set(point.timestamp, point);
  }
  return Array.from(unique.values()).sort(
    (a, b) => parseTimeMs(a.timestamp) - parseTimeMs(b.timestamp)
  );
}

export function buildTrajectorySegment(points: EphemerisTrajectory[]): TrajectorySegment | null {
  const normalized = normalizeTrajectoryPoints(points);
  if (normalized.length === 0) return null;

  const pointTimesMs = normalized.map((point) => parseTimeMs(point.timestamp));
  return {
    startTime: normalized[0].timestamp,
    endTime: normalized[normalized.length - 1].timestamp,
    startTimeMs: pointTimesMs[0],
    endTimeMs: pointTimesMs[pointTimesMs.length - 1],
    pointTimesMs,
    points: normalized,
  };
}

function canMergeSegments(a: TrajectorySegment, b: TrajectorySegment): boolean {
  return !(a.endTimeMs + MERGE_GAP_MS < b.startTimeMs || b.endTimeMs + MERGE_GAP_MS < a.startTimeMs);
}

function mergeManySegments(segments: TrajectorySegment[]): TrajectorySegment {
  const points = segments.flatMap((segment) => segment.points);
  const merged = buildTrajectorySegment(points);
  if (!merged) {
    throw new Error('Unable to merge empty trajectory segments');
  }
  return merged;
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
      compacted[compacted.length - 1] = mergeManySegments([last, segment]);
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
  maxSegments = 3
): TrajectorySegment[] {
  const incoming = buildTrajectorySegment(incomingPoints);
  if (!incoming) return existing;

  const mergeCandidates: TrajectorySegment[] = [incoming];
  const kept: TrajectorySegment[] = [];

  for (const segment of existing) {
    if (canMergeSegments(segment, incoming)) {
      mergeCandidates.push(segment);
    } else {
      kept.push(segment);
    }
  }

  const merged = mergeManySegments(mergeCandidates);
  const compacted = compactMergeableSegments([...kept, merged]);
  return trimSegmentsAroundTime(compacted, anchorTimeMs, maxSegments);
}

export function flattenTrajectorySegments(segments: TrajectorySegment[]): EphemerisTrajectory[] {
  return normalizeTrajectoryPoints(segments.flatMap((segment) => segment.points));
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

function findIntervalIndex(pointTimesMs: number[], timeMs: number): number {
  let left = 0;
  let right = pointTimesMs.length - 2;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const t1 = pointTimesMs[mid];
    const t2 = pointTimesMs[mid + 1];
    if (timeMs < t1) {
      right = mid - 1;
    } else if (timeMs > t2) {
      left = mid + 1;
    } else {
      return mid;
    }
  }

  return Math.max(0, Math.min(pointTimesMs.length - 2, left));
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

  return {
    x: h00 * p1.position.x + h10 * m0x + h01 * p2.position.x + h11 * m1x,
    y: h00 * p1.position.y + h10 * m0y + h01 * p2.position.y + h11 * m1y,
    z: h00 * p1.position.z + h10 * m0z + h01 * p2.position.z + h11 * m1z,
  };
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
  timeMs: number
): SampledTrajectoryPoint | null {
  if (segments.length === 0) return null;

  const ordered = sortSegments(segments);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];

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
      segmentIndex: ordered.length - 1,
      pointIndex: last.points.length - 1,
      clamped: true,
      status: 'after_all',
    };
  }

  const segmentIndex = findSegmentIndexForTime(ordered, timeMs);
  if (segmentIndex === -1) {
    const nearest = clampToNearestGapEndpoint(ordered, timeMs);
    return {
      position: nearest.position,
      segmentIndex: nearest.segmentIndex,
      pointIndex: nearest.pointIndex,
      clamped: true,
      status: 'gap',
    };
  }

  const segment = ordered[segmentIndex];
  const { points, pointTimesMs } = segment;
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

  const idx = findIntervalIndex(pointTimesMs, timeMs);
  const p1 = points[idx];
  const p2 = points[idx + 1];
  const t1 = pointTimesMs[idx];
  const t2 = pointTimesMs[idx + 1];
  const spanMs = t2 - t1;
  if (spanMs <= 0) {
    return {
      position: p1.position,
      segmentIndex,
      pointIndex: idx,
      clamped: true,
      status: 'covered',
    };
  }

  const alpha = Math.max(0, Math.min(1, (timeMs - t1) / spanMs));
  const interpolated = interpolateHermite(p1, p2, alpha, spanMs / 1000);
  return {
    position: interpolated,
    segmentIndex,
    pointIndex: idx,
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

