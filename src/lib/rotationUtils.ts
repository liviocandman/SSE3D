/**
 * Rotation utilities for celestial bodies
 */

/**
 * Calculates the rotation step (in radians) for a single frame.
 * 
 * Formula: ( (2 * Math.PI) / dayLength ) * (delta / 3600) * timeMultiplier
 * - dayLength: Siderial day in hours (positive for prograde, negative for retrograde)
 * - delta: Time since last frame in seconds
 * - timeMultiplier: Simulation speed (1 = real time)
 * 
 * Note: 1 hour = 3600 seconds.
 */
export function calculateRotationStep(
  dayLength: number,
  delta: number,
  timeMultiplier: number
): number {
  if (dayLength === 0) return 0;
  
  // Radians per hour
  const radiansPerHour = (2 * Math.PI) / dayLength;
  
  // Delta in hours
  const deltaHours = delta / 3600;
  
  // Rotation step = radians/hour * hours * multiplier
  return radiansPerHour * deltaHours * timeMultiplier;
}
