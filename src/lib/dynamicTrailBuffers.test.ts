import { describe, expect, it } from 'vitest';
import { Color, DynamicDrawUsage, InterleavedBufferAttribute } from 'three';
import { LineGeometry } from 'three-stdlib';
import { buildTrailSamples, createDynamicTrailBuffers, updateDynamicTrailBuffers, type TrailSample } from './dynamicTrailBuffers';
import { densifyWithCatmullRom } from './catmullRom';
import { buildTrajectorySegments } from './trajectoryEngine';

const samples: TrailSample[] = Array.from({ length: 10 }, (_, index) => ({
  timestampMs: index,
  point: { x: index * 10, y: index * 2, z: index },
}));

describe('dynamic trail GPU buffers', () => {
  it('keeps attributes and arrays across updates, and uploads only active segment pairs', () => {
    const geometry = new LineGeometry();
    const buffers = createDynamicTrailBuffers(geometry, 6);
    const start = geometry.getAttribute('instanceStart') as InterleavedBufferAttribute;
    const end = geometry.getAttribute('instanceEnd') as InterleavedBufferAttribute;
    const color = geometry.getAttribute('instanceColorStart');
    const array = buffers.positions.array;
    const colors = buffers.colors.array;
    const range = buffers.positionRange;
    expect(start.data).toBe(end.data);
    expect(start.data.usage).toBe(DynamicDrawUsage);
    for (let i = 0; i < 1000; i++) {
      updateDynamicTrailBuffers(buffers, samples, 9, 4, { x: i, y: 2, z: 3 }, 0.1, new Color(1, 0.5, 0.25));
      expect(geometry.getAttribute('instanceStart')).toBe(start);
      expect(geometry.getAttribute('instanceEnd')).toBe(end);
      expect(geometry.getAttribute('instanceColorStart')).toBe(color);
      expect(buffers.positions.array).toBe(array);
      expect(buffers.colors.array).toBe(colors);
      expect(buffers.positions.updateRanges).toEqual([{ start: 0, count: 18 }]);
      expect(buffers.positions.updateRanges[0]).toBe(range);
      // Simulate WebGL upload clearing ranges for the next update.
      buffers.positions.clearUpdateRanges();
      buffers.colors.clearUpdateRanges();
    }
    expect(geometry.instanceCount).toBe(3);
    expect(start.getX(0)).toBeCloseTo((90 - 999) * 0.1);
    expect(end.getX(0)).toBeCloseTo((80 - 999) * 0.1);
    expect(start.getY(0)).toBeCloseTo(1.6);
    expect(start.getZ(0)).toBeCloseTo(0.6);
    expect(Array.from(colors.slice(0, 3))).toEqual([1, 0.5, 0.25]);
    expect(Array.from(colors.slice(15, 18))).toEqual([0, 0, 0]);
    geometry.dispose();
  });

  it('reduces the instance count after reverse playback so stale segments are not drawn', () => {
    const geometry = new LineGeometry();
    const buffers = createDynamicTrailBuffers(geometry, 6);
    const origin = { x: 0, y: 0, z: 0 };
    const color = new Color('white');
    updateDynamicTrailBuffers(buffers, samples, 9, 6, origin, 1, color);
    expect(geometry.instanceCount).toBe(5);
    updateDynamicTrailBuffers(buffers, samples, 2, 3, origin, 1, color);
    expect(geometry.instanceCount).toBe(2);
    expect(buffers.positions.updateRanges).toEqual([{ start: 0, count: 12 }]);
    expect(Array.from(buffers.positions.array.slice(0, 6))).toEqual([20, 4, 2, 10, 2, 1]);
    updateDynamicTrailBuffers(buffers, samples, 0, 1, origin, 1, color);
    expect(geometry.instanceCount).toBe(0);
    geometry.dispose();
  });

  it('matches the previous Catmull-Rom shape using only the fixed visible GPU window', () => {
    const trajectory = samples.map((sample, index) => ({
      timestamp: new Date(index * 86400000).toISOString(),
      position: { x: sample.point.x, y: index * index, z: sample.point.z },
    }));
    const raw = trajectory.map((point) => ({ timestampMs: Date.parse(point.timestamp), point: point.position }));
    const dense = densifyWithCatmullRom(trajectory, 8);
    const geometry = new LineGeometry();
    const buffers = createDynamicTrailBuffers(geometry, 6);
    updateDynamicTrailBuffers(buffers, raw, 47, 6, { x: 0, y: 0, z: 0 }, 1, new Color('white'), 8);
    const start = geometry.getAttribute('instanceStart') as InterleavedBufferAttribute;
    const end = geometry.getAttribute('instanceEnd') as InterleavedBufferAttribute;
    for (let i = 0; i < 5; i++) {
      expect(start.getX(i)).toBeCloseTo(dense[47 - i].position.x);
      expect(start.getY(i)).toBeCloseTo(dense[47 - i].position.y);
      expect(end.getX(i)).toBeCloseTo(dense[46 - i].position.x);
      expect(end.getY(i)).toBeCloseTo(dense[46 - i].position.y);
    }
    expect(buffers.positions.array.length).toBe(30);
    expect(raw).toHaveLength(10);
    geometry.dispose();
  });
});

describe('trail discontinuities', () => {
  const origin = { x: 0, y: 0, z: 0 };
  const color = new Color('white');
  const trajectory = [0, 1, 2, 100, 101, 102].map((second, index) => ({
    timestamp: new Date(second * 1000).toISOString(),
    position: { x: index < 3 ? index * 10 : 1000 + (index - 3) * 10, y: index ** 2, z: 0 },
  }));
  const runs = buildTrajectorySegments(trajectory, '399');

  it('preserves segment boundaries and scientific position identity in the rendering input', () => {
    const raw = buildTrailSamples(runs);
    expect(raw.map((sample) => sample.breakBefore)).toEqual([true, false, false, true, false, false]);
    expect(raw.map((sample) => sample.timestampMs)).toEqual([0, 1000, 2000, 100_000, 101_000, 102_000]);
    expect(raw[3].point).toBe(trajectory[3].position);
  });

  it.each([1, 8])('draws and smooths each run independently with %i subdivisions', (subdivisions) => {
    const raw = buildTrailSamples(runs);
    const last = (raw.length - 1) * subdivisions;
    const geometry = new LineGeometry();
    const buffers = createDynamicTrailBuffers(geometry, last + 1);
    updateDynamicTrailBuffers(buffers, raw, last, last + 1, origin, 1, color, subdivisions);
    const start = geometry.getAttribute('instanceStart') as InterleavedBufferAttribute;
    const end = geometry.getAttribute('instanceEnd') as InterleavedBufferAttribute;
    const expected = [...runs].reverse().flatMap((run) => {
      const points = subdivisions === 1 ? run.points : densifyWithCatmullRom(run.points, subdivisions);
      return points.slice(1).map((_, index) => ({
        start: points[points.length - index - 1].position,
        end: points[points.length - index - 2].position,
      }));
    });
    expect(geometry.instanceCount).toBe(4 * subdivisions);
    expect(buffers.positions.updateRanges).toEqual([{ start: 0, count: expected.length * 6 }]);
    expected.forEach((pair, index) => {
      expect(start.getX(index)).toBeCloseTo(pair.start.x);
      expect(start.getY(index)).toBeCloseTo(pair.start.y);
      expect(end.getX(index)).toBeCloseTo(pair.end.x);
      expect(end.getY(index)).toBeCloseTo(pair.end.y);
    });
    geometry.dispose();
  });

  it('draws no synthetic portion of a gap when the visible cutoff is inside it', () => {
    const raw = buildTrailSamples(runs);
    const geometry = new LineGeometry();
    const buffers = createDynamicTrailBuffers(geometry, 48);
    const array = buffers.positions.array;
    updateDynamicTrailBuffers(buffers, raw, 40, 41, origin, 1, color, 8);
    expect(geometry.instanceCount).toBe(32);
    updateDynamicTrailBuffers(buffers, raw, 20, 21, origin, 1, color, 8);
    expect(geometry.instanceCount).toBe(16);
    const start = geometry.getAttribute('instanceStart') as InterleavedBufferAttribute;
    const end = geometry.getAttribute('instanceEnd') as InterleavedBufferAttribute;
    for (let index = 0; index < geometry.instanceCount; index++) {
      expect(start.getX(index)).toBeLessThanOrEqual(20);
      expect(end.getX(index)).toBeLessThanOrEqual(20);
    }
    expect(buffers.positions.array).toBe(array);
    expect(buffers.positions.updateRanges).toEqual([{ start: 0, count: 96 }]);
    geometry.dispose();
  });

  it('hides stale geometry when all visible samples are isolated', () => {
    const geometry = new LineGeometry();
    const buffers = createDynamicTrailBuffers(geometry, 6);
    updateDynamicTrailBuffers(buffers, samples, 5, 6, origin, 1, color, 1);
    expect(geometry.instanceCount).toBe(5);
    const isolated = samples.map((sample) => ({ ...sample, breakBefore: true }));
    updateDynamicTrailBuffers(buffers, isolated, 5, 6, origin, 1, color, 1);
    expect(geometry.instanceCount).toBe(0);
    geometry.dispose();
  });

  it('keeps a break even when the positions on both sides are identical', () => {
    const matching = trajectory.map((point, index) => index === 3
      ? { ...point, position: trajectory[2].position } : point);
    const raw = buildTrailSamples(buildTrajectorySegments(matching, '399'));
    expect(raw).toHaveLength(6);
    expect(raw[3].breakBefore).toBe(true);
    const geometry = new LineGeometry();
    const buffers = createDynamicTrailBuffers(geometry, 6);
    updateDynamicTrailBuffers(buffers, raw, 5, 6, origin, 1, color);
    expect(geometry.instanceCount).toBe(4);
    geometry.dispose();
  });
});
