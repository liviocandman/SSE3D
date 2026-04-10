/**
 * Camera Stability & Kinematics Configuration
 * Centralized tuning parameters for the camera system.
 */

export const CAMERA_CONFIG = {
  // --- Framing ---
  DEFAULT_OFFSET: [0, 50, 150] as [number, number, number],
  MIN_FOCUS_OFFSET: 0.00005,      // Minimum distance to prevent clipping/float issues
  FOCUS_RADIUS_MULTIPLIER: 3.5,   // Framing distance relative to object radius
};
