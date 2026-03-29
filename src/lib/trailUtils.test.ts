import { describe, it, expect } from 'vitest';
import { calculateTrailAlpha, getTrailVertexColors } from './trailUtils';

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

  it('should generate normalized RGB tuples for vertex colors', () => {
    const color = '#ffffff'; // White
    const pointsCount = 3; // head, middle, tail
    
    // index 0 -> alpha 1.0 -> [1,1,1]
    // index 1 -> alpha 0.5 -> [0.5,0.5,0.5]
    // index 2 -> alpha 0.0 -> [0,0,0]
    const result = getTrailVertexColors(pointsCount, color, 'tail');
    
    expect(result.length).toBe(3);
    expect(result[0]).toEqual([1, 1, 1]);
    expect(result[1]).toEqual([0.5, 0.5, 0.5]);
    expect(result[2]).toEqual([0, 0, 0]);
  });
});
