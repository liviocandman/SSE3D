/**
 * Utilities for camera-relative rendering.
 * 
 * Absolute positions are in KM (astronomical truth).
 * Render positions are in KM relative to a chosen Render Origin.
 * 
 * Three.js uses Float32 for rendering. At lunar distances (~384,000 km),
 * precision is roughly 0.05 km (50 meters). Camera-relative rendering
 * keeps the camera and local focus target near (0,0,0) in render-space,
 * restoring sub-meter precision for detailed models.
 */

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Computes a render-relative position from an absolute position and an origin.
 */
export function toRelativePosition(
  absolute: Vector3Like,
  origin: Vector3Like
): Vector3Like {
  return {
    x: absolute.x - origin.x,
    y: absolute.y - origin.y,
    z: absolute.z - origin.z,
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
