import { describe, expect, it } from 'vitest';
import { Color, DynamicDrawUsage, InterleavedBufferAttribute } from 'three';
import { LineGeometry } from 'three-stdlib';
import { createDynamicTrailBuffers, updateDynamicTrailBuffers, type TrailSample } from './dynamicTrailBuffers';
import { densifyWithCatmullRom } from './catmullRom';

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
