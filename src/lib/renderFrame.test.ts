import { describe, it, expect } from 'vitest';
import {
  toRelativePosition,
  isRenderOriginNearTarget,
  toRelativeRenderUnits,
} from './renderFrame';

describe('renderFrame utilities', () => {
  const origin = { x: 100, y: 200, z: 300 };

  it('computes relative position correctly', () => {
    const absolute = { x: 110, y: 190, z: 305 };
    const relative = toRelativePosition(absolute, origin);
    
    expect(relative).toEqual({ x: 10, y: -10, z: 5 });
  });

  it('identity with zero origin', () => {
    const zeroOrigin = { x: 0, y: 0, z: 0 };
    const absolute = { x: 1, y: 2, z: 3 };
    expect(toRelativePosition(absolute, zeroOrigin)).toEqual(absolute);
  });

  it('converts absolute KM to relative render units', () => {
    const absoluteKm = { x: 1_500_000, y: -500_000, z: 250_000 };
    const originKm = { x: 1_000_000, y: -1_000_000, z: 0 };
    const kmToUnit = 1 / 1_000_000;

    expect(toRelativeRenderUnits(absoluteKm, originKm, kmToUnit)).toEqual({
      x: 0.5,
      y: 0.5,
      z: 0.25,
    });
  });

  it('detects origin near target', () => {
    const target = { x: 100.05, y: 200, z: 300 };
    // Default tolerance is 0.1
    expect(isRenderOriginNearTarget(origin, target)).toBe(true);
    
    const farTarget = { x: 100.2, y: 200, z: 300 };
    expect(isRenderOriginNearTarget(origin, farTarget)).toBe(false);
  });
});
