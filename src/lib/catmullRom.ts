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
 */
export function densifyWithCatmullRom(
  points: EphemerisTrajectory[],
  subdivisions: number
): EphemerisTrajectory[] {
  if (points.length < 2 || subdivisions <= 1) return points;

  const result: EphemerisTrajectory[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    // Clamp outer phantom points at boundaries (standard Catmull-Rom endpoint handling)
    const p0 = points[Math.max(0, i - 1)].position;
    const p1 = points[i].position;
    const p2 = points[i + 1].position;
    const p3 = points[Math.min(points.length - 1, i + 2)].position;

    const t1 = new Date(
      points[i].timestamp.includes('Z') ? points[i].timestamp : `${points[i].timestamp}Z`
    ).getTime();
    const t2 = new Date(
      points[i + 1].timestamp.includes('Z') ? points[i + 1].timestamp : `${points[i + 1].timestamp}Z`
    ).getTime();

    // Push the real anchor at the start of this segment
    result.push(points[i]);

    // Inject (subdivisions - 1) synthetic interior points
    for (let s = 1; s < subdivisions; s++) {
      const alpha = s / subdivisions;
      const pos = catmullRomPoint(p0, p1, p2, p3, alpha);

      // Safety: skip NaN (degenerate control points should not crash the renderer)
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
        continue;
      }

      // Linearly interpolated timestamp - used for binary-search cutoff in DynamicTrailLine
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
