import * as THREE from 'three';
import { useSolarStore } from '@/store/solarStore';
import { useMissionStore } from '@/store/missionStore';
import { samplePlanet } from './planetarySampler';
import { sampleMoon } from './moonSampler';
import { sampleMission } from './missionSampler';
import type { SampleStatus, MissionSampleSource } from './types';
import type { TemporalLookupCache } from '../temporalLookup';
import { type TrajectorySegment, buildTrajectorySegment } from '../trajectoryEngine';
import { PLANET_MOONS } from '@/lib/textureConfig';
import { BODY_IDS } from '@/lib/types';

import type { MissionTrajectory } from '@/lib/missionTypes';

/**
 * Caching for mission trajectory segment to avoid reconstruction every frame.
 */
let cachedMissionTrajectory: MissionTrajectory | null = null;
let cachedMissionSegment: TrajectorySegment | null = null;

function getCachedMissionSegment(missionTrajectory: MissionTrajectory | null): TrajectorySegment | null {
  if (!missionTrajectory) {
    cachedMissionTrajectory = null;
    cachedMissionSegment = null;
    return null;
  }

  if (missionTrajectory === cachedMissionTrajectory) {
    return cachedMissionSegment;
  }

  const combinedPoints = [...missionTrajectory.past, ...missionTrajectory.planned];
  if (combinedPoints.length >= 2) {
    cachedMissionSegment = buildTrajectorySegment(
      combinedPoints.map((point) => ({
        timestamp: point.timestamp,
        position: {
          x: point.position.x,
          y: point.position.y,
          z: point.position.z,
        },
        velocity: point.velocity
          ? {
              x: point.velocity.x,
              y: point.velocity.y,
              z: point.velocity.z,
            }
          : undefined,
      }))
    );
  } else {
    cachedMissionSegment = null;
  }

  cachedMissionTrajectory = missionTrajectory;
  return cachedMissionSegment;
}

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
 * High-level resolver for the mission spacecraft.
 */
export function resolveMissionFrame(
  timeMs: number,
  outAbsolutePositionKm: THREE.Vector3,
  outEarthRelativePositionKm: THREE.Vector3,
  outHeading: THREE.Quaternion,
  previousEarthRelativePositionKm?: THREE.Vector3 | null
): MissionSampleSource {
  const solarState = useSolarStore.getState();
  const missionStore = useMissionStore.getState();
  
  const missionState = missionStore.missionState;
  const missionTrajectory = missionStore.missionTrajectory;
  const earthSegments = solarState.masterTrajectorySegments[BODY_IDS.EARTH] ?? [];

  const missionTrajectorySegment = getCachedMissionSegment(missionTrajectory);

  return sampleMission(
    timeMs,
    missionState,
    missionTrajectory,
    missionTrajectorySegment,
    earthSegments,
    outAbsolutePositionKm,
    outEarthRelativePositionKm,
    outHeading,
    previousEarthRelativePositionKm
  );
}

/**
 * Domain-agnostic resolver for the camera follow system.
 * Centralizes the branching logic for Orion, moons, and planets.
 */
const tempEarthRelative = new THREE.Vector3();
const tempHeading = new THREE.Quaternion();
const tempLocal = new THREE.Vector3();

export function resolveGeneralTargetFrame(
  targetId: string,
  timeMs: number,
  outAbsPos: THREE.Vector3,
  lookupCache: TemporalLookupCache,
  parentLookupCache: TemporalLookupCache
): boolean {
  // 1) Mission Domain
  if (targetId === 'Orion' || targetId === 'orion') {
    const source = resolveMissionFrame(
      timeMs,
      outAbsPos,
      tempEarthRelative,
      tempHeading
    );
    return source !== 'none';
  }

  // 2) Moon Domain
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

  // 3) Planet Domain
  const status = resolvePlanetFrame(
    targetId,
    timeMs,
    outAbsPos,
    lookupCache
  );
  
  // Basic validation (Sun is allowed at 0,0,0)
  return status !== 'no-data' && (outAbsPos.x !== 0 || outAbsPos.y !== 0 || outAbsPos.z !== 0 || targetId === BODY_IDS.SUN);
}
