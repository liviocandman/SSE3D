/**
 * Canonical utilities for camera-relative rendering.
 * 
 * Absolute positions are in KM (astronomical truth).
 * Render positions are in KM relative to a chosen Render Origin.
 * 
 * Three.js uses Float32 for rendering. Camera-relative rendering
 * keeps the camera and local focus target near (0,0,0) in render-space,
 * restoring sub-meter precision for detailed models.
 */

import * as THREE from 'three';

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Computes a render-relative position from an absolute position and an origin.
 * Returns units in KM.
 */
export function toRelativePosition(
  absoluteKm: Vector3Like,
  originKm: Vector3Like
): Vector3Like {
  return {
    x: absoluteKm.x - originKm.x,
    y: absoluteKm.y - originKm.y,
    z: absoluteKm.z - originKm.z,
  };
}

/**
 * Performant relative unit conversion into an existing Vector3.
 * Avoids allocation in frame loops.
 */
export function toRelativeRenderUnitsInto(
  out: THREE.Vector3,
  absoluteKm: Vector3Like,
  originKm: Vector3Like,
  kmToUnit: number
): THREE.Vector3 {
  return out.set(
    (absoluteKm.x - originKm.x) * kmToUnit,
    (absoluteKm.y - originKm.y) * kmToUnit,
    (absoluteKm.z - originKm.z) * kmToUnit
  );
}

/**
 * Reconstructs absolute KM from relative render units.
 */
export function worldCameraKm(
  cameraPosUnits: THREE.Vector3,
  originKm: Vector3Like,
  kmToUnit: number
): Vector3Like {
  const invScale = 1 / kmToUnit;
  return {
    x: originKm.x + cameraPosUnits.x * invScale,
    y: originKm.y + cameraPosUnits.y * invScale,
    z: originKm.z + cameraPosUnits.z * invScale,
  };
}

/**
 * Convenience helper to subtract origin from a set of coordinates.
 */
export function subtractRenderOrigin(
  absolute: Vector3Like,
  origin: Vector3Like
): Vector3Like {
  return toRelativePosition(absolute, origin);
}

/**
 * Checks if a render origin is already near a target within a tolerance (in KM).
 * Useful to avoid micro-updates to the render origin.
 */
export function isRenderOriginNearTarget(
  origin: Vector3Like,
  target: Vector3Like,
  toleranceKm: number = 0.1
): boolean {
  const dx = origin.x - target.x;
  const dy = origin.y - target.y;
  const dz = origin.z - target.z;
  const distanceSq = dx * dx + dy * dy + dz * dz;
  return distanceSq < toleranceKm * toleranceKm;
}
