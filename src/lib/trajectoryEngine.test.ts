import { describe, expect, it } from 'vitest';
import type { EphemerisTrajectory } from '@/lib/types';
import {
  buildTrajectorySegment,
  computeBufferPlan,
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
    let segments = upsertTrajectorySegments([], makeTrajectory('2026-01-01T00:00:00.000Z', 3), Date.now(), 3);
    segments = upsertTrajectorySegments(segments, makeTrajectory('2026-02-01T00:00:00.000Z', 3), Date.now(), 3);
    segments = upsertTrajectorySegments(segments, makeTrajectory('2026-03-01T00:00:00.000Z', 3), Date.now(), 3);
    segments = upsertTrajectorySegments(segments, makeTrajectory('2026-04-01T00:00:00.000Z', 3), Date.now(), 3);

    expect(segments).toHaveLength(3);
  });

  it('should keep upserted segments sorted by start time', () => {
    let segments = upsertTrajectorySegments([], makeTrajectory('2026-03-01T00:00:00.000Z', 3), Date.now(), 4);
    segments = upsertTrajectorySegments(segments, makeTrajectory('2026-01-01T00:00:00.000Z', 3), Date.now(), 4);
    segments = upsertTrajectorySegments(segments, makeTrajectory('2026-04-01T00:00:00.000Z', 3), Date.now(), 4);
    segments = upsertTrajectorySegments(segments, makeTrajectory('2026-02-01T00:00:00.000Z', 3), Date.now(), 4);

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
});

