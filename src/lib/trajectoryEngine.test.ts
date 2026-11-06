import { describe, expect, it } from 'vitest';
import type { EphemerisTrajectory } from '@/lib/types';
import {
  buildTrajectorySegment,
  computeBufferPlan,
  flattenTrajectorySegments,
  MAX_TRAJECTORY_POINTS_PER_BODY,
  TRAJECTORY_RETENTION_RADIUS_MS,
  sampleTrajectoryAtTime,
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

