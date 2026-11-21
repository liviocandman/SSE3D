import { getRadius, type ViewMode } from './scales';
import { getPlanetConfig, PLANET_MOONS } from './textureConfig';

export const CAMERA_CONFIG = {
  // --- Framing ---
  DEFAULT_OFFSET: [0, 50, 150] as [number, number, number],
  MIN_FOCUS_OFFSET: 0.00005,      // Minimum distance to prevent clipping/float issues
  FOCUS_RADIUS_MULTIPLIER: 3.5,   // Framing distance relative to object radius
  MAX_DISTANCE: 50000,
};

/** Radius and framing are always expressed in current visual render units. */
export function getBodyCameraFraming(bodyId: string, viewMode: ViewMode, near = 0.00001) {
  const config = getPlanetConfig(bodyId);
  if (!config) return null;
  const radius = getRadius(bodyId, config.bodyClass, viewMode);
  const systemMultiplier = config.bodyClass === 'MOON' ? 2 : PLANET_MOONS[bodyId] ? 5 : 1;
  const minDistance = Math.max(CAMERA_CONFIG.MIN_FOCUS_OFFSET, radius * 1.25 + near * 2);
  return {
    radius,
    minDistance,
    distance: Math.max(minDistance, radius * systemMultiplier * CAMERA_CONFIG.FOCUS_RADIUS_MULTIPLIER),
  };
}
