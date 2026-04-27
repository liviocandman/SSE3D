import * as THREE from 'three';
import { sampleTrajectoryAtTime, type TrajectorySegment } from '../trajectoryEngine';
import type { TemporalLookupCache } from '../temporalLookup';
import type { SampleStatus } from './types';
import { samplePlanet } from './planetarySampler';

// Shared temp vector to avoid GC pressure in the frame loop
const tempParentPos = new THREE.Vector3();

/**
 * Samples a moon's position relative to its parent and its absolute position.
 * Most moons in this system are stored in parent-relative KM from SPICE.
 */
export function sampleMoon(
  moonId: string,
  parentId: string,
  timeMs: number,
  moonSegments: TrajectorySegment[],
  parentSegments: TrajectorySegment[],
  outAbsolutePositionKm: THREE.Vector3,
  outLocalPositionKm: THREE.Vector3,
  moonLookupCache?: TemporalLookupCache | null,
  parentLookupCache?: TemporalLookupCache | null
): SampleStatus {
  // 1. Resolve parent absolute position
  const parentStatus = samplePlanet(parentId, timeMs, parentSegments, tempParentPos, parentLookupCache);

  // 2. Resolve moon relative position (to parent)
  if (!moonSegments || moonSegments.length === 0) {
    outLocalPositionKm.set(0, 0, 0);
    outAbsolutePositionKm.copy(tempParentPos);
    return 'no-data';
  }

  const moonResult = sampleTrajectoryAtTime(moonSegments, timeMs, moonLookupCache);

  if (moonResult) {
    outLocalPositionKm.set(moonResult.position.x, moonResult.position.y, moonResult.position.z);
    outAbsolutePositionKm.copy(tempParentPos).add(outLocalPositionKm);

    // Merge status logic (prioritize moon data status)
    if (moonResult.status !== 'covered') {
      switch (moonResult.status) {
        case 'before_all': return 'before_all';
        case 'after_all': return 'after_all';
        case 'gap': return 'gap';
      }
    }
    return parentStatus === 'ok' ? 'ok' : 'fallback';
  }

  outLocalPositionKm.set(0, 0, 0);
  outAbsolutePositionKm.copy(tempParentPos);
  return 'no-data';
}
