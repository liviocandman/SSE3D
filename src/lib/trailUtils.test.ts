import { describe, it, expect } from 'vitest';
import { calculateTrailAlpha } from './trailUtils';

describe('TrailUtils Alpha Calculation', () => {
  it('should calculate tail alpha correctly (linear fade from 1 to 0)', () => {
    const totalPoints = 11;
    expect(calculateTrailAlpha(0, totalPoints, 'tail')).toBe(1.0);
    expect(calculateTrailAlpha(5, totalPoints, 'tail')).toBe(0.5);
    expect(calculateTrailAlpha(10, totalPoints, 'tail')).toBe(0.0);
  });

  it('should calculate ring alpha correctly (sine-based, peaks at middle)', () => {
    const totalPoints = 11;
    // Math.sin(0) = 0
    expect(calculateTrailAlpha(0, totalPoints, 'ring')).toBeCloseTo(0.0);
    // Math.sin(PI/2) = 1
    expect(calculateTrailAlpha(5, totalPoints, 'ring')).toBeCloseTo(1.0);
    // Math.sin(PI) = 0
    expect(calculateTrailAlpha(10, totalPoints, 'ring')).toBeCloseTo(0.0);
  });
});
