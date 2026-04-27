import * as THREE from 'three';
import { sampleTrajectoryAtTime, type TrajectorySegment } from '../trajectoryEngine';
import type { TemporalLookupCache } from '../temporalLookup';
import type { SampleStatus } from './types';

/**
 * Samples a planetary body's position from its trajectory segments.
 * Uses the "Out Parameter" pattern to avoid Garbage Collection pressure.
 * 
 * @param bodyId The unique identifier of the planet (e.g., '10' for Sun, '399' for Earth)
 * @param timeMs The simulation time in milliseconds
 * @param segments High-precision trajectory segments from SPICE/NASA
 * @param outPosition Vector3 that will be mutated to store the absolute position in KM
 * @param lookupCache Optional temporal lookup cache for performance
 * @returns The sample status
 */
export function samplePlanet(
  bodyId: string,
  timeMs: number,
  segments: TrajectorySegment[],
  outPosition: THREE.Vector3,
  lookupCache?: TemporalLookupCache | null
): SampleStatus {
  if (!segments || segments.length === 0) {
    outPosition.set(0, 0, 0);
    return 'no-data';
  }

  const result = sampleTrajectoryAtTime(segments, timeMs, lookupCache);

  if (result) {
    outPosition.set(result.position.x, result.position.y, result.position.z);
    
    // Convert engine status to our common simulation status
    switch (result.status) {
      case 'before_all': return 'before_all';
      case 'after_all': return 'after_all';
      case 'gap': return 'gap';
      default: return 'ok';
    }
  }

  outPosition.set(0, 0, 0);
  return 'no-data';
}
