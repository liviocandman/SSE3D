import { describe, expect, it } from 'vitest';
import type { EphemerisTrajectory } from '@/lib/types';
import {
  buildTrajectorySegment,
  buildTrajectorySegments,
  computeBufferPlan,
  flattenTrajectorySegments,
  hasCoverageAtTime,
  hasCoverageNearTime,
  MAX_TRAJECTORY_POINTS_PER_BODY,
  TRAJECTORY_RETENTION_RADIUS_MS,
  sampleTrajectoryAtTime,
  sampleTrajectoryStateAtTime,
  upsertTrajectorySegments,
} from './trajectoryEngine';

function makeTrajectory(
  startIso: string,
  points: number,
  stepHours = 6,
  withVelocity = true
): EphemerisTrajectory[] {
  const startMs = new Date(startIso).getTime();
  return Array.from({ length: points }, (_, index) => {
    const timestamp = new Date(startMs + index * stepHours * 60 * 60 * 1000).toISOString();
    return {
      timestamp,
      position: { x: index * 100, y: 0, z: 0 },
      velocity: withVelocity ? { x: 5 + index, y: 0, z: 0 } : undefined,
    };
  });
}

describe('trajectoryEngine', () => {
  it('should clamp to nearest endpoint when sampling in a gap between segments', () => {
    const segA = buildTrajectorySegment(makeTrajectory('2026-01-01T00:00:00.000Z', 3))!;
    const segB = buildTrajectorySegment(makeTrajectory('2026-03-01T00:00:00.000Z', 3))!;
    const gapMid = Math.floor((segA.endTimeMs + segB.startTimeMs) / 2);

    const sampled = sampleTrajectoryAtTime([segA, segB], gapMid);
    expect(sampled).not.toBeNull();
    expect(sampled?.status).toBe('gap');
    expect(sampled?.clamped).toBe(true);
  });

  it('should use Hermite interpolation when velocity is available', () => {
    const points: EphemerisTrajectory[] = [
      {
        timestamp: '2026-01-01T00:00:00.000Z',
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 50, y: 0, z: 0 },
      },
      {
        timestamp: '2026-01-01T00:00:10.000Z',
        position: { x: 100, y: 0, z: 0 },
        velocity: { x: -10, y: 0, z: 0 },
      },
    ];
    const segment = buildTrajectorySegment(points)!;

    const sampled = sampleTrajectoryAtTime([segment], new Date('2026-01-01T00:00:05.000Z').getTime());
    expect(sampled).not.toBeNull();
    expect(sampled?.status).toBe('covered');
    // Linear midpoint would be x=50; Hermite with these tangents should deviate from that.
    expect(sampled!.position.x).not.toBeCloseTo(50, 4);
  });

  it('should keep at most 3 segments after upserts', () => {
    const anchor = Date.parse('2026-03-01T00:00:00Z');
    let segments = upsertTrajectorySegments([], makeTrajectory('2026-01-01T00:00:00.000Z', 3), anchor, 3);
    segments = upsertTrajectorySegments(segments, makeTrajectory('2026-02-01T00:00:00.000Z', 3), anchor, 3);
    segments = upsertTrajectorySegments(segments, makeTrajectory('2026-03-01T00:00:00.000Z', 3), anchor, 3);
    segments = upsertTrajectorySegments(segments, makeTrajectory('2026-04-01T00:00:00.000Z', 3), anchor, 3);

    expect(segments).toHaveLength(3);
  });

  it('samples velocity as the derivative of the same Hermite curve used for position', () => {
    const startMs = Date.parse('2026-01-01T00:00:00Z');
    const segment = buildTrajectorySegment([
      { timestamp: new Date(startMs).toISOString(), position: { x: 0, y: 0, z: 0 }, velocity: { x: 50, y: 2, z: -3 } },
      { timestamp: new Date(startMs + 10_000).toISOString(), position: { x: 100, y: 20, z: -30 }, velocity: { x: -10, y: 2, z: -3 } },
    ])!;
    const state = sampleTrajectoryStateAtTime([segment], startMs + 5000)!;
    expect(state.position).toEqual(sampleTrajectoryAtTime([segment], startMs + 5000)?.position);
    expect(state.velocity).toEqual({ x: 5, y: 2, z: -3 });
    expect(sampleTrajectoryStateAtTime([segment], startMs)?.velocity).toEqual(segment.points[0].velocity);
    expect(sampleTrajectoryStateAtTime([segment], startMs + 10_000)?.velocity).toEqual(segment.points[1].velocity);
  });

  it('derives velocity from the linear path when velocity vectors are absent', () => {
    const segment = buildTrajectorySegment(makeTrajectory('2026-01-01T00:00:00Z', 2, 1, false))!;
    expect(sampleTrajectoryStateAtTime([segment], segment.startTimeMs + 1_800_000)?.velocity?.x).toBeCloseTo(100 / 3600);
  });

  it('does not report clamped endpoints as current telemetry outside coverage or in gaps', () => {
    const a = buildTrajectorySegment(makeTrajectory('2026-01-01T00:00:00Z', 2))!;
    const b = buildTrajectorySegment(makeTrajectory('2026-03-01T00:00:00Z', 2))!;
    for (const time of [a.startTimeMs - 1, b.endTimeMs + 1, (a.endTimeMs + b.startTimeMs) / 2, NaN]) {
      expect(sampleTrajectoryStateAtTime([a, b], time)).toBeNull();
    }
    expect(sampleTrajectoryStateAtTime([], a.startTimeMs)).toBeNull();
  });

  it('should keep upserted segments sorted by start time', () => {
    const anchor = Date.parse('2026-03-01T00:00:00Z');
    let segments = upsertTrajectorySegments([], makeTrajectory('2026-03-01T00:00:00.000Z', 3), anchor, 4);
    segments = upsertTrajectorySegments(segments, makeTrajectory('2026-01-01T00:00:00.000Z', 3), anchor, 4);
    segments = upsertTrajectorySegments(segments, makeTrajectory('2026-04-01T00:00:00.000Z', 3), anchor, 4);
    segments = upsertTrajectorySegments(segments, makeTrajectory('2026-02-01T00:00:00.000Z', 3), anchor, 4);

    expect(segments.map((segment) => segment.startTime)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
    ]);
  });

  it('computeBufferPlan should pause and request current date when uncovered', () => {
    const segment = buildTrajectorySegment(makeTrajectory('2026-01-01T00:00:00.000Z', 3))!;
    const plan = computeBufferPlan({
      segments: [segment],
      timeMs: new Date('2026-02-01T00:00:00.000Z').getTime(),
      thresholdDays: 10,
      fetchSpanDays: 30,
      timeMultiplier: 10,
      currentDate: '2026-02-01',
    });

    expect(plan.pause).toBe(true);
    expect(plan.fetchDates).toEqual(['2026-02-01']);
  });

  it('computeBufferPlan should request future near segment end', () => {
    const segment = buildTrajectorySegment(makeTrajectory('2026-01-01T00:00:00.000Z', 120))!;
    const nearEnd = segment.endTimeMs - 2 * 24 * 60 * 60 * 1000;
    const plan = computeBufferPlan({
      segments: [segment],
      timeMs: nearEnd,
      thresholdDays: 10,
      fetchSpanDays: 30,
      timeMultiplier: 10,
      currentDate: '2026-01-20',
    });

    expect(plan.pause).toBe(false);
    expect(plan.fetchDates.length).toBe(1);
  });

  it.each([1, -1])('bounds continuous sessions in direction %i without losing interpolation', (direction) => {
    const start = Date.parse('2026-01-01T00:00:00Z');
    const dayMs = 86400000;
    let segments: ReturnType<typeof upsertTrajectorySegments> = [];
    for (let block = 0; block < 80; block++) {
      const blockStart = start + block * direction * 30 * dayMs;
      const points = makeTrajectory(new Date(blockStart).toISOString(), 481, 1.5);
      const anchor = blockStart + 15 * dayMs + 1234;
      segments = upsertTrajectorySegments(segments, points, anchor);
      const flat = flattenTrajectorySegments(segments);
      expect(flat.length).toBeLessThanOrEqual(MAX_TRAJECTORY_POINTS_PER_BODY);
      expect(segments[0].startTimeMs).toBeGreaterThanOrEqual(anchor - TRAJECTORY_RETENTION_RADIUS_MS - 1.5 * 3600000);
      expect(segments.at(-1)!.endTimeMs).toBeLessThanOrEqual(anchor + TRAJECTORY_RETENTION_RADIUS_MS + 1.5 * 3600000);
      expect(sampleTrajectoryAtTime(segments, anchor)?.position).toEqual(
        sampleTrajectoryAtTime([buildTrajectorySegment(points)!], anchor)?.position,
      );
    }
  });

  it('preserves the two original interpolation neighbors even with a tiny point budget', () => {
    const points = makeTrajectory('2026-01-01T00:00:00Z', 100, 1);
    const anchor = Date.parse('2026-01-03T00:30:00Z');
    const original = buildTrajectorySegment(points)!;
    const segments = upsertTrajectorySegments([], points, anchor, 3, { maxPoints: 2, radiusMs: 86400000 });
    expect(segments[0].points).toEqual([points[48], points[49]]);
    expect(sampleTrajectoryAtTime(segments, anchor)).toMatchObject({
      position: sampleTrajectoryAtTime([original], anchor)!.position,
      clamped: false,
    });
  });

  it('retains boundary neighbors and drops old data after a distant seek', () => {
    const points = makeTrajectory('2026-01-01T00:00:00Z', 100, 24);
    const anchor = Date.parse('2026-02-01T12:00:00Z');
    const retention = { maxPoints: 4096, radiusMs: 2 * 86400000 };
    let segments = upsertTrajectorySegments([], points, anchor, 3, retention);
    expect(segments[0].startTime).toBe('2026-01-30T00:00:00.000Z');
    expect(segments[0].endTime).toBe('2026-02-04T00:00:00.000Z');
    const seekTime = Date.parse('2036-02-01T12:00:00Z');
    segments = upsertTrajectorySegments(segments, makeTrajectory('2036-02-01T00:00:00Z', 100, 24), seekTime, 3, retention);
    expect(segments).toHaveLength(1);
    expect(segments[0].startTime).toBe('2036-02-01T00:00:00.000Z');
    expect(sampleTrajectoryAtTime(segments, seekTime)?.status).toBe('covered');
  });

  it('reuses unchanged scientific data and accepts corrected overlap samples', () => {
    const points = makeTrajectory('2026-01-01T00:00:00Z', 10);
    const anchor = Date.parse(points[5].timestamp);
    const original = upsertTrajectorySegments([], points, anchor);
    const duplicate = points.map((point) => ({ ...point, position: { ...point.position } }));
    expect(upsertTrajectorySegments(original, duplicate, anchor)).toBe(original);
    expect(flattenTrajectorySegments(original)).toBe(original[0].points);
    const correction = { ...points[5], position: { x: 999, y: 0, z: 0 } };
    const corrected = upsertTrajectorySegments(original, [correction], anchor);
    expect(corrected[0].points[5]).toBe(correction);
    expect(corrected[0].points[4]).toBe(original[0].points[4]);
  });

  it('does not replace the retained window when an oversized download is repeated', () => {
    const points = makeTrajectory('2026-01-01T00:00:00Z', 100, 1);
    const anchor = Date.parse('2026-01-03T00:30:00Z');
    const retention = { maxPoints: 8, radiusMs: 86400000 };
    const original = upsertTrajectorySegments([], points, anchor, 3, retention);
    const repeated = points.map((point) => ({ ...point, position: { ...point.position } }));
    expect(upsertTrajectorySegments(original, repeated, anchor, 3, retention)).toBe(original);
  });
});

describe('trajectory continuity', () => {
  const start = Date.parse('2026-01-01T00:00:00Z');
  const hour = 3_600_000;
  function atMinutes(minutes: number[]): EphemerisTrajectory[] {
    return minutes.map((minute) => ({
      timestamp: new Date(start + minute * 60_000).toISOString(),
      position: { x: minute, y: 0, z: 0 },
    }));
  }

  it.each([1, -1])('preserves a sub-36-hour hole between downloads in direction %i', (direction) => {
    const blocks = [makeTrajectory(new Date(start).toISOString(), 3), makeTrajectory(new Date(start + 24 * hour).toISOString(), 3)];
    if (direction < 0) blocks.reverse();
    const timeMs = start + 18 * hour;
    let segments: ReturnType<typeof upsertTrajectorySegments> = [];
    for (const block of blocks) segments = upsertTrajectorySegments(segments, block, timeMs, 3, undefined, '399');
    expect(segments).toHaveLength(2);
    expect(hasCoverageAtTime(segments, timeMs)).toBe(false);
    expect(hasCoverageNearTime(segments, timeMs, 24 * hour)).toBe(false);
    expect(sampleTrajectoryAtTime(segments, timeMs)).toMatchObject({ status: 'gap', clamped: true });
    expect(sampleTrajectoryStateAtTime(segments, timeMs)).toBeNull();
    expect(computeBufferPlan({ segments, timeMs, thresholdDays: 1, fetchSpanDays: 45,
      timeMultiplier: direction, currentDate: '2026-01-01' })).toEqual({ pause: true, fetchDates: ['2026-01-01'] });
  });

  it('splits an internal missing sample and restores coverage only after it arrives', () => {
    const points = atMinutes([0, 5, 10, 20, 25, 30]);
    const timeMs = start + 15 * 60_000;
    const segments = upsertTrajectorySegments([], points, timeMs, 3, undefined, '401');
    expect(segments).toHaveLength(2);
    expect(hasCoverageAtTime(segments, timeMs)).toBe(false);
    const filled = upsertTrajectorySegments(segments, atMinutes([10, 15, 20]), timeMs, 3, undefined, '401');
    expect(filled).toHaveLength(1);
    expect(hasCoverageAtTime(filled, timeMs)).toBe(true);
    expect(sampleTrajectoryAtTime(filled, timeMs)?.position.x).toBe(15);
  });

  it('detects an internal hole even in a single segment and holds the nearest actual sample', () => {
    const points = atMinutes([0, 5, 10, 60, 65, 70]);
    const segment = buildTrajectorySegment(points, '401')!;
    const timeMs = start + 20 * 60_000;
    expect(hasCoverageAtTime([segment], timeMs)).toBe(false);
    expect(sampleTrajectoryAtTime([segment], timeMs)).toMatchObject({
      status: 'gap', position: points[2].position, pointIndex: 2,
    });
  });

  it('does not interpolate a rapid moon across cadence that is valid for a regular moon', () => {
    const points = atMinutes([0, 45, 90, 135]);
    const rapid = buildTrajectorySegments(points, '401');
    const regular = buildTrajectorySegments(points, '501');
    expect(hasCoverageAtTime(rapid, start + 30 * 60_000)).toBe(false);
    expect(hasCoverageAtTime(regular, start + 30 * 60_000)).toBe(true);
    // A two-point payload cannot establish continuity beyond the body's bound.
    expect(hasCoverageAtTime(buildTrajectorySegments([points[0], points[1]], '401'), start + 30 * 60_000)).toBe(false);
  });

  it('keeps normal cadence contiguous across rounded timestamps and shared endpoints', () => {
    const step = 2 * 24 * hour / 199;
    const block = (offset: number) => Array.from({ length: 200 }, (_, index) => ({
      timestamp: new Date(Math.round(start + offset + index * step)).toISOString(),
      position: { x: offset + index, y: 0, z: 0 },
    }));
    let segments = upsertTrajectorySegments([], block(0), start, 3, undefined, '401');
    segments = upsertTrajectorySegments(segments, block(2 * 24 * hour), start + 2 * 24 * hour, 3, undefined, '401');
    expect(segments).toHaveLength(1);
    expect(hasCoverageAtTime(segments, start + 2 * 24 * hour)).toBe(true);
    expect(hasCoverageAtTime(segments, start + 3 * 24 * hour)).toBe(true);
  });

  it('uses the local edge cadence after merging downloads with different sampling rates', () => {
    let segments = upsertTrajectorySegments([], atMinutes([0, 30, 60]), start + hour, 3, undefined, '399');
    segments = upsertTrajectorySegments(segments, atMinutes([60, 61, 62]), start + hour, 3, undefined, '399');
    segments = upsertTrajectorySegments(segments, atMinutes([65, 66, 67]), start + hour, 3, undefined, '399');
    expect(segments).toHaveLength(2);
    expect(hasCoverageAtTime(segments, start + 64 * 60_000)).toBe(false);
  });

  it('preserves gaps and reference identity across retention and repeated downloads', () => {
    const points = atMinutes([0, 5, 10, 20, 25, 30]);
    const anchor = start + 15 * 60_000;
    const retention = { maxPoints: 2, radiusMs: hour };
    const segments = upsertTrajectorySegments([], points, anchor, 3, retention, '401');
    expect(flattenTrajectorySegments(segments)).toHaveLength(2);
    expect(hasCoverageAtTime(segments, anchor)).toBe(false);
    expect(upsertTrajectorySegments(segments, points, anchor, 3, retention, '401')).toBe(segments);
  });

  it('does not bridge a sample removed by normalization', () => {
    const points = atMinutes([0, 5, 10, 15, 20]);
    points[2] = { ...points[2], position: { x: NaN, y: 0, z: 0 } };
    const segments = buildTrajectorySegments(points, '401');
    expect(segments).toHaveLength(2);
    expect(hasCoverageAtTime(segments, start + 10 * 60_000)).toBe(false);
  });

  it('allows fetch tolerance outside the buffer without expanding internal coverage', () => {
    const segments = buildTrajectorySegments(atMinutes([0, 5, 10, 20, 25, 30]), '401');
    expect(hasCoverageNearTime(segments, start - 60_000, 120_000)).toBe(true);
    expect(hasCoverageNearTime(segments, start + 31 * 60_000, 120_000)).toBe(true);
    expect(hasCoverageNearTime(segments, start - 180_000, 120_000)).toBe(false);
    expect(hasCoverageNearTime(segments, start + 15 * 60_000, hour)).toBe(false);
  });
});

