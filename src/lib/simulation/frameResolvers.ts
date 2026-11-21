import * as THREE from 'three';
import { samplePlanet } from './planetarySampler';
import { sampleMoon } from './moonSampler';
import type { SampleStatus } from './types';
import type { TemporalLookupCache } from '../temporalLookup';
import type { TrajectorySegment } from '../trajectoryEngine';
import { BODY_IDS } from '@/lib/types';
import { MOON_PARENT_BY_ID, resolveBodySegmentsAtTime } from './trajectoryQueries';

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
  // A successful point query can arrive before the replacement window has
  // been merged into the master buffer. Prefer whichever buffer covers the
  // requested instant; a stale master endpoint must not mask fresh data.
  const segments = resolveBodySegmentsAtTime(bodyId, timeMs, fallbackSegments);
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
  const moonSegments = resolveBodySegmentsAtTime(moonId, timeMs);
  const parentSegments = resolveBodySegmentsAtTime(parentId, timeMs);
  
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
