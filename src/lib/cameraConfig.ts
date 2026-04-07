/**
 * Camera Stability & Kinematics Configuration
 * Centralized tuning parameters for the camera system.
 */

export const CAMERA_CONFIG = {
  // --- Stability (Phase 1/2) ---
  ORIGIN_HYSTERESIS_KM: 1.0,      // Shift origin only if target moves > 1km
  ORIGIN_SMOOTHING_MS: 300,       // Duration of origin rebase transition
  ORIGIN_APPLY_TOLERANCE_KM: 0.05, // Avoid excessive store updates for micro origin deltas
  ORIGIN_MAX_UPDATE_HZ: 30,       // Cap render-origin store updates to reduce churn
  ORIGIN_HARD_SNAP_KM: 250,       // Large drifts snap immediately to avoid lag accumulation
  DEAD_ZONE_UNITS: 0.00000001,    // Stop pivot updates if error is below this (~10m)

  // --- Damping ---

  DAMPING_PIVOT: 12,              // Smoothness factor for camera target
  DAMPING_OFFSET: 8,              // Smoothness factor for camera position
  DAMPING_INTERACTION: 20,        // Snap back faster after user interaction
  
  // --- Kinematics (Phase 2) ---
  MAX_LINEAR_SPEED: 50,           // Max units/sec (scene units)
  MAX_LINEAR_ACCEL: 120,          // Max acceleration (scene units/sec²)
  MAX_ANGULAR_SPEED: Math.PI * 2, // Max rotation speed per second
  TRAVEL_TARGET_DURATION_S: 1.8,  // Preferred duration for auto-focus travel
  TRAVEL_MIN_SPEED: 18,           // Lower bound for travel speed
  TRAVEL_MAX_SPEED: 90,           // Upper bound for travel speed
  
  // --- Framing ---
  DEFAULT_OFFSET: [0, 50, 150] as [number, number, number],
  MIN_FOCUS_OFFSET: 0.00005,      // Minimum distance to prevent clipping/float issues
  FOCUS_RADIUS_MULTIPLIER: 3.5,   // Framing distance relative to object radius
};
