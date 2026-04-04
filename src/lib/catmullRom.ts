import type { EphemerisPosition, EphemerisTrajectory } from './types';

/**
 * Catmull-Rom spline interpolation using four control points.
 * p0, p3 are the outer phantom control points; p1..p2 is the active segment.
 * alpha in [0, 1]: 0 returns p1, 1 returns p2.
 */
export function catmullRomPoint(
  p0: EphemerisPosition,
  p1: EphemerisPosition,
  p2: EphemerisPosition,
  p3: EphemerisPosition,
  alpha: number
): EphemerisPosition {
  const a2 = alpha * alpha;
  const a3 = a2 * alpha;

  // Standard Catmull-Rom basis coefficients
  const q0 = -a3 + 2 * a2 - alpha;
  const q1 =  3 * a3 - 5 * a2 + 2;
  const q2 = -3 * a3 + 4 * a2 + alpha;
  const q3 =  a3 - a2;

  return {
    x: 0.5 * (q0 * p0.x + q1 * p1.x + q2 * p2.x + q3 * p3.x),
    y: 0.5 * (q0 * p0.y + q1 * p1.y + q2 * p2.y + q3 * p3.y),
    z: 0.5 * (q0 * p0.z + q1 * p1.z + q2 * p2.z + q3 * p3.z),
  };
}

/**
 * Densifies a sorted trajectory by injecting synthetic interpolated points
 * between each adjacent pair using Catmull-Rom.
 *
 * @param points  - Sorted, deduplicated real trajectory points
 * @param subdivisions - Total segments per raw interval. 
 *                       e.g. 4 -> inserts 3 synthetic pts between each pair.
 * @param options - Optional configuration including velocityThreshold for burn detection.
 */
export function densifyWithCatmullRom(
  points: EphemerisTrajectory[],
  subdivisions: number,
  options?: { velocityThreshold?: number }
): EphemerisTrajectory[] {
  if (points.length < 2 || subdivisions <= 1) return points;

  const result: EphemerisTrajectory[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const pCurrent = points[i];
    const pNext = points[i + 1];

    // --- Burn Guard Logic ---
    // If a velocity threshold is provided and both points have velocity data,
    // calculate the magnitude of the velocity change (Delta-V).
    let isBurnDetected = false;
    if (options?.velocityThreshold && pCurrent.velocity && pNext.velocity) {
      const dv = {
        x: pNext.velocity.x - pCurrent.velocity.x,
        y: pNext.velocity.y - pCurrent.velocity.y,
        z: pNext.velocity.z - pCurrent.velocity.z,
      };
      const deltaVMagnitude = Math.sqrt(dv.x * dv.x + dv.y * dv.y + dv.z * dv.z);
      
      if (deltaVMagnitude > options.velocityThreshold) {
        isBurnDetected = true;
      }
    }

    // Push the real anchor at the start of this segment
    result.push(pCurrent);

    if (isBurnDetected) {
      // Do not interpolate segments containing a burn to avoid fake curves.
      // The segment will remain a straight line between the two real points.
      continue;
    }

    // --- Spline Interpolation ---
    // Clamp outer phantom points at boundaries (standard Catmull-Rom endpoint handling)
    const p0 = points[Math.max(0, i - 1)].position;
    const p1 = pCurrent.position;
    const p2 = pNext.position;
    const p3 = points[Math.min(points.length - 1, i + 2)].position;

    const t1 = new Date(
      pCurrent.timestamp.includes('Z') ? pCurrent.timestamp : `${pCurrent.timestamp}Z`
    ).getTime();
    const t2 = new Date(
      pNext.timestamp.includes('Z') ? pNext.timestamp : `${pNext.timestamp}Z`
    ).getTime();

    // Inject (subdivisions - 1) synthetic interior points
    for (let s = 1; s < subdivisions; s++) {
      const alpha = s / subdivisions;
      const pos = catmullRomPoint(p0, p1, p2, p3, alpha);

      // Safety: skip NaN (degenerate control points should not crash the renderer)
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
        continue;
      }

      // Linearly interpolated timestamp
      const syntheticTimestamp = new Date(Math.round(t1 + alpha * (t2 - t1))).toISOString();
      
      result.push({ 
        position: pos, 
        timestamp: syntheticTimestamp 
      });
    }
  }

  // Always include the final real anchor
  result.push(points[points.length - 1]);
  return result;
}
