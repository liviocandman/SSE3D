import * as THREE from 'three';
import { useSolarStore } from '@/store/solarStore';
import { samplePlanet } from './planetarySampler';
import { sampleMoon } from './moonSampler';
import type { SampleStatus } from './types';
import type { TemporalLookupCache } from '../temporalLookup';
import { hasCoverageAtTime, sampleTrajectoryAtTime, type TrajectorySegment } from '../trajectoryEngine';
import { PLANET_MOONS } from '@/lib/textureConfig';
import { BODY_IDS, type EphemerisPosition } from '@/lib/types';

/**
 * Static mapping of moons to parents for fast routing.
 */
const MOON_PARENT_BY_ID: Record<string, string> = Object.entries(PLANET_MOONS).reduce(
  (acc, [parentId, moonIds]) => {
    moonIds.forEach((moonId) => {
      acc[moonId] = parentId;
    });
    return acc;
  },
  {} as Record<string, string>
);

/** Travel requires current scientific coverage, including the moon's parent.
 * Rendering resolvers may hold endpoints outside coverage; those are unsuitable
 * as a destination. Exact covered endpoints remain valid for travel. */
export function resolveCoveredTargetPosition(
  bodyId: string,
  timeMs: number,
  fallbackSegments: TrajectorySegment[] = [],
): EphemerisPosition | null {
  const state = useSolarStore.getState();
  const segments = state.masterTrajectorySegments[bodyId]?.length
    ? state.masterTrajectorySegments[bodyId] : fallbackSegments;
  if (!hasCoverageAtTime(segments, timeMs)) return null;
  const sample = sampleTrajectoryAtTime(segments, timeMs);
  if (!sample) return null;

  const parentId = MOON_PARENT_BY_ID[bodyId];
  if (!parentId) return { ...sample.position };
  const parentSegments = state.masterTrajectorySegments[parentId] ?? [];
  if (!hasCoverageAtTime(parentSegments, timeMs)) return null;
  const parent = sampleTrajectoryAtTime(parentSegments, timeMs);
  if (!parent) return null;
  return {
    x: sample.position.x + parent.position.x,
    y: sample.position.y + parent.position.y,
    z: sample.position.z + parent.position.z,
  };
}

/**
 * High-level resolver for planetary bodies.
 * Accesses the Solar Store non-reactively.
 */
export function resolvePlanetFrame(
  bodyId: string,
  timeMs: number,
  outAbsolutePositionKm: THREE.Vector3,
  lookupCache?: TemporalLookupCache | null,
  fallbackSegments?: TrajectorySegment[]
): SampleStatus {
  const state = useSolarStore.getState();
  const segments = (state.masterTrajectorySegments[bodyId]?.length > 0)
    ? state.masterTrajectorySegments[bodyId]
    : (fallbackSegments ?? []);
  return samplePlanet(bodyId, timeMs, segments, outAbsolutePositionKm, lookupCache);
}

/**
 * High-level resolver for moons.
 * Resolves both absolute and parent-relative positions.
 */
export function resolveMoonFrame(
  moonId: string,
  parentId: string,
  timeMs: number,
  outAbsolutePositionKm: THREE.Vector3,
  outLocalPositionKm: THREE.Vector3,
  moonLookupCache?: TemporalLookupCache | null,
  parentLookupCache?: TemporalLookupCache | null
): SampleStatus {
  const state = useSolarStore.getState();
  const moonSegments = state.masterTrajectorySegments[moonId] ?? [];
  const parentSegments = state.masterTrajectorySegments[parentId] ?? [];
  
  return sampleMoon(
    moonId,
    parentId,
    timeMs,
    moonSegments,
    parentSegments,
    outAbsolutePositionKm,
    outLocalPositionKm,
    moonLookupCache,
    parentLookupCache
  );
}

/**
 * Domain-agnostic resolver for the camera follow system.
 * Centralizes the branching logic for moons and planets.
 */
const tempLocal = new THREE.Vector3();

export function resolveGeneralTargetFrame(
  targetId: string,
  timeMs: number,
  outAbsPos: THREE.Vector3,
  lookupCache: TemporalLookupCache,
  parentLookupCache: TemporalLookupCache
): boolean {
  // 1) Moon Domain
  const parentId = MOON_PARENT_BY_ID[targetId];
  if (parentId) {
    const status = resolveMoonFrame(
      targetId,
      parentId,
      timeMs,
      outAbsPos,
      tempLocal,
      lookupCache,
      parentLookupCache
    );
    return status !== 'no-data';
  }

  // 2) Planet Domain
  const status = resolvePlanetFrame(
    targetId,
    timeMs,
    outAbsPos,
    lookupCache
  );
  
  // Basic validation (Sun is allowed at 0,0,0)
  return status !== 'no-data' && (outAbsPos.x !== 0 || outAbsPos.y !== 0 || outAbsPos.z !== 0 || targetId === BODY_IDS.SUN);
}
