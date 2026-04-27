import * as THREE from 'three';

/**
 * Status of a sampled point in time.
 */
export type SampleStatus = 
  | 'ok'           // Data found and interpolated correctly
  | 'no-data'      // No segments available for this body
  | 'before_all'   // Time is before the first available data point (clamped)
  | 'after_all'    // Time is after the last available data point (clamped)
  | 'gap'          // Time is in a gap between segments (clamped to nearest)
  | 'fallback';    // Using low-precision or static fallback data

/**
 * Source of the mission data.
 */
export type MissionSampleSource = 
  | 'telemetry'    // Real-time sceneCoordinates from API
  | 'trajectory'   // Interpolated from SPK/OEM segments
  | 'none';        // No data available

/**
 * Standard output for a resolved planetary body frame.
 * All units in Kilometers unless otherwise specified.
 */
export interface ResolvedPlanetFrame {
  bodyId: string;
  absolutePositionKm: THREE.Vector3;
  status: SampleStatus;
}

/**
 * Standard output for a resolved moon frame.
 * Moon trajectories are typically parent-relative in this system.
 */
export interface ResolvedMoonFrame {
  bodyId: string;
  parentId: string;
  absolutePositionKm: THREE.Vector3;
  localPositionKm: THREE.Vector3;
  status: SampleStatus;
}

/**
 * Standard output for a resolved mission (spacecraft) frame.
 */
export interface ResolvedMissionFrame {
  vehicleId: string;
  absolutePositionKm: THREE.Vector3;
  earthRelativePositionKm: THREE.Vector3;
  heading: THREE.Quaternion;
  source: MissionSampleSource;
}
