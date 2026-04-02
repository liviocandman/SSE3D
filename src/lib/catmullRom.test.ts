import { describe, it, expect } from 'vitest';
import { catmullRomPoint, densifyWithCatmullRom } from './catmullRom';

const P = (x: number, y: number, z: number) => ({ x, y, z });

describe('catmullRomPoint', () => {
  it('returns p1 when alpha=0', () => {
    const result = catmullRomPoint(P(0,0,0), P(1,0,0), P(2,0,0), P(3,0,0), 0);
    expect(result.x).toBeCloseTo(1); // p1.x
  });

  it('returns p2 when alpha=1', () => {
    const result = catmullRomPoint(P(0,0,0), P(1,0,0), P(2,0,0), P(3,0,0), 1);
    expect(result.x).toBeCloseTo(2); // p2.x
  });

  it('produces a point between p1 and p2 for alpha=0.5', () => {
    const result = catmullRomPoint(P(0,0,0), P(1,0,0), P(2,0,0), P(3,0,0), 0.5);
    expect(result.x).toBeGreaterThan(1);
    expect(result.x).toBeLessThan(2);
  });

  it('returns finite values at degenerate boundary (p0 === p1)', () => {
    const result = catmullRomPoint(P(1,0,0), P(1,0,0), P(2,0,0), P(3,0,0), 0.5);
    expect(Number.isFinite(result.x)).toBe(true);
  });
});

describe('densifyWithCatmullRom', () => {
  const makePoints = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      timestamp: new Date(i * 3600000).toISOString(),
      position: P(i * 100, 0, 0),
    }));

  it('multiplies point count correctly (5 pts, subdivisions=4 → 17)', () => {
    // 5 real pts + (5-1) gaps * 3 synthetic pts = 5 + 12 = 17
    const result = densifyWithCatmullRom(makePoints(5), 4);
    expect(result.length).toBe(17);
  });

  it('preserves all original anchor timestamps in output', () => {
    const input = makePoints(4);
    const result = densifyWithCatmullRom(input, 4);
    const outputTimestamps = new Set(result.map(p => p.timestamp));
    input.forEach(p => expect(outputTimestamps.has(p.timestamp)).toBe(true));
  });

  it('returns original array unchanged when subdivisions <= 1', () => {
    const input = makePoints(5);
    expect(densifyWithCatmullRom(input, 1)).toBe(input);
  });

  it('handles minimum input of 2 points without error', () => {
    const result = densifyWithCatmullRom(makePoints(2), 4);
    expect(result.length).toBe(2 + 3); // 2 anchors + 3 synthetic = 5
  });

  it('returns the original array when fewer than 2 points', () => {
    const input = makePoints(1);
    expect(densifyWithCatmullRom(input, 4)).toBe(input);
  });
});
