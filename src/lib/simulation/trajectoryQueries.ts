import { useSolarStore } from '@/store/solarStore';
import { hasCoverageAtTime, sampleTrajectoryAtTime, type TrajectorySegment } from '../trajectoryEngine';
import { PLANET_MOONS } from '@/lib/textureConfig';
import type { EphemerisPosition } from '@/lib/types';

/**
 * Static mapping of moons to parents for fast routing.
 */
export const MOON_PARENT_BY_ID: Record<string, string> = Object.entries(PLANET_MOONS).reduce(
  (acc, [parentId, moonIds]) => {
    moonIds.forEach((moonId) => {
      acc[moonId] = parentId;
    });
    return acc;
  },
  {} as Record<string, string>
);

const EMPTY_SEGMENTS: TrajectorySegment[] = [];

export function selectSegmentsAtTime(
  master: TrajectorySegment[] | undefined,
  base: TrajectorySegment[] | undefined,
  timeMs: number,
): TrajectorySegment[] {
  if (!master?.length) return base ?? EMPTY_SEGMENTS;
  if (!base?.length || hasCoverageAtTime(master, timeMs)) return master;
  return hasCoverageAtTime(base, timeMs) ? base : master;
}

export function resolveBodySegmentsAtTime(bodyId: string, timeMs: number, fallback?: TrajectorySegment[]): TrajectorySegment[] {
  const state = useSolarStore.getState();
  return selectSegmentsAtTime(state.masterTrajectorySegments[bodyId], state.baseTrajectorySegments[bodyId] ?? fallback, timeMs);
}

/** Travel requires current scientific coverage, including the moon's parent.
 * Rendering resolvers may hold endpoints outside coverage; those are unsuitable
 * as a destination. Exact covered endpoints remain valid for travel. */
export function resolveCoveredTargetPosition(
  bodyId: string,
  timeMs: number,
  fallbackSegments: TrajectorySegment[] = [],
): EphemerisPosition | null {
  // The shared point-query buffer can supersede a stale master window. A
  // caller's raw payload is available during bootstrap before either is set.
  const sharedSegments = resolveBodySegmentsAtTime(bodyId, timeMs);
  const segments = sharedSegments.length ? sharedSegments : fallbackSegments;
  if (!hasCoverageAtTime(segments, timeMs)) return null;
  const sample = sampleTrajectoryAtTime(segments, timeMs);
  if (!sample) return null;

  const parentId = MOON_PARENT_BY_ID[bodyId];
  if (!parentId) return { ...sample.position };
  const parentSegments = resolveBodySegmentsAtTime(parentId, timeMs);
  if (!hasCoverageAtTime(parentSegments, timeMs)) return null;
  const parent = sampleTrajectoryAtTime(parentSegments, timeMs);
  if (!parent) return null;
  return {
    x: sample.position.x + parent.position.x,
    y: sample.position.y + parent.position.y,
    z: sample.position.z + parent.position.z,
  };
}
