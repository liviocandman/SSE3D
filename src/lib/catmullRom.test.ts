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

  describe('burn guard', () => {
    const p1 = { timestamp: '2026-01-01T00:00:00Z', position: P(0, 0, 0), velocity: { x: 1, y: 0, z: 0 } };
    const p2 = { timestamp: '2026-01-01T01:00:00Z', position: P(10, 0, 0), velocity: { x: 10, y: 0, z: 0 } }; // Delta-V = 9

    it('blocks interpolation when delta-V exceeds threshold', () => {
      // 5 subdivisions would normally add 4 points.
      // With burn detected, it only adds the start point of the segment.
      const result = densifyWithCatmullRom([p1, p2], 5, { velocityThreshold: 5 });
      
      // result = [p1, p2]
      expect(result.length).toBe(2);
      expect(result[0].timestamp).toBe(p1.timestamp);
      expect(result[1].timestamp).toBe(p2.timestamp);
    });

    it('allows interpolation when delta-V is below threshold', () => {
      const result = densifyWithCatmullRom([p1, p2], 5, { velocityThreshold: 20 });
      
      // 2 real pts + 4 synthetic = 6
      expect(result.length).toBe(6);
    });

    it('ignores guard when velocity data is missing', () => {
      const pNoVel1 = { timestamp: '2026-01-01T00:00:00Z', position: P(0, 0, 0) };
      const pNoVel2 = { timestamp: '2026-01-01T01:00:00Z', position: P(10, 0, 0) };
      
      const result = densifyWithCatmullRom([pNoVel1, pNoVel2], 5, { velocityThreshold: 1 });
      expect(result.length).toBe(6);
    });
  });
});
