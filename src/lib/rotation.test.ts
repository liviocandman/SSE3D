import { describe, it, expect } from 'vitest';
import { calculateRotationStep } from './rotationUtils';

describe('calculateRotationStep', () => {
  const delta = 1/60; // 60 FPS

  it('calculates positive rotation for Earth (prograde)', () => {
    const dayLength = 24;
    const timeMultiplier = 1;
    const step = calculateRotationStep(dayLength, delta, timeMultiplier);
    expect(step).toBeGreaterThan(0);
    // (2*PI/24) * ( (1/60)/3600 ) * 1
    expect(step).toBeCloseTo((2 * Math.PI / 24) * (delta / 3600), 10);
  });

  it('calculates negative rotation for Venus (retrograde)', () => {
    const dayLength = -5832.5;
    const timeMultiplier = 1;
    const step = calculateRotationStep(dayLength, delta, timeMultiplier);
    expect(step).toBeLessThan(0);
  });

  it('returns 0 when dayLength is 0', () => {
    const step = calculateRotationStep(0, delta, 1);
    expect(step).toBe(0);
  });

  it('returns 0 when timeMultiplier is 0', () => {
    const step = calculateRotationStep(24, delta, 0);
    expect(step).toBe(0);
  });

  it('scales linearly with timeMultiplier', () => {
    const step1 = calculateRotationStep(24, delta, 1);
    const step10 = calculateRotationStep(24, delta, 10);
    expect(step10).toBeCloseTo(step1 * 10, 10);
  });
});
