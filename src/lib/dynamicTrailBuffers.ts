import {
  DynamicDrawUsage,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  type Color,
  type InstancedBufferGeometry,
} from 'three';
import type { Vector3Like } from './renderFrame';
import type { TrajectorySegment } from './trajectoryEngine';

export interface TrailSample {
  timestampMs: number;
  point: Vector3Like;
  /** No edge or smoothing tangent may connect this sample to its predecessor. */
  breakBefore?: boolean;
}

export function buildTrailSamples(segments: readonly TrajectorySegment[]): TrailSample[] {
  const result: TrailSample[] = [];
  for (const segment of segments) {
    let breakBefore = true;
    for (let index = 0; index < segment.points.length; index++) {
      const point = segment.points[index].position;
      const timestampMs = segment.pointTimesMs[index];
      if (!Number.isFinite(timestampMs) || !Number.isFinite(point.x)
        || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
        breakBefore = true;
        continue;
      }
      result.push({
        timestampMs, point,
        breakBefore: breakBefore || (index > 0
          && timestampMs - segment.pointTimesMs[index - 1] > segment.maxGapMs),
      });
      breakBefore = false;
    }
  }
  return result;
}

/** Persistent endpoint pairs: Line2 renders one instance per adjacent pair. */
export function createDynamicTrailBuffers(geometry: InstancedBufferGeometry, maxPoints: number) {
  const capacity = Math.max(1, Math.floor(maxPoints) - 1);
  const positions = new InstancedInterleavedBuffer(new Float32Array(capacity * 6), 6);
  const colors = new InstancedInterleavedBuffer(new Float32Array(capacity * 6), 6);
  positions.setUsage(DynamicDrawUsage);
  colors.setUsage(DynamicDrawUsage);
  geometry.setAttribute('instanceStart', new InterleavedBufferAttribute(positions, 3, 0));
  geometry.setAttribute('instanceEnd', new InterleavedBufferAttribute(positions, 3, 3));
  geometry.setAttribute('instanceColorStart', new InterleavedBufferAttribute(colors, 3, 0));
  geometry.setAttribute('instanceColorEnd', new InterleavedBufferAttribute(colors, 3, 3));
  geometry.instanceCount = 0;
  return {
    geometry,
    positions,
    colors,
    capacity,
    positionRange: { start: 0, count: 0 },
    colorRange: { start: 0, count: 0 },
    scratchStart: { x: 0, y: 0, z: 0 },
    scratchEnd: { x: 0, y: 0, z: 0 },
  };
}

export type DynamicTrailBuffers = ReturnType<typeof createDynamicTrailBuffers>;

/** Evaluate only the visible synthetic vertices; scientific data stays untouched. */
function visualPositionInto(
  target: Vector3Like,
  samples: readonly TrailSample[],
  visualIndex: number,
  subdivisions: number,
): Vector3Like {
  const index = Math.floor(visualIndex / subdivisions);
  const alpha = (visualIndex % subdivisions) / subdivisions;
  if (alpha === 0) return samples[index].point;
  const p1 = samples[index].point;
  const p2 = samples[Math.min(samples.length - 1, index + 1)].point;
  // Repeat endpoints at each continuous run's boundaries, just as an isolated
  // Catmull-Rom curve would. Remote samples must not bend a neighboring run.
  const p0 = index > 0 && !samples[index].breakBefore ? samples[index - 1].point : p1;
  const p3 = index + 2 < samples.length && !samples[index + 2].breakBefore ? samples[index + 2].point : p2;
  const a2 = alpha * alpha;
  const a3 = a2 * alpha;
  const q0 = -a3 + 2 * a2 - alpha;
  const q1 = 3 * a3 - 5 * a2 + 2;
  const q2 = -3 * a3 + 4 * a2 + alpha;
  const q3 = a3 - a2;
  target.x = 0.5 * (q0 * p0.x + q1 * p1.x + q2 * p2.x + q3 * p3.x);
  target.y = 0.5 * (q0 * p0.y + q1 * p1.y + q2 * p2.y + q3 * p3.y);
  target.z = 0.5 * (q0 * p0.z + q1 * p1.z + q2 * p2.z + q3 * p3.z);
  return target;
}

export function updateDynamicTrailBuffers(
  buffers: DynamicTrailBuffers,
  samples: readonly TrailSample[],
  lastVisibleIndex: number,
  pointCount: number,
  origin: Vector3Like,
  kmToUnit: number,
  color: Color,
  subdivisions = 1,
): void {
  const count = Math.min(buffers.capacity, Math.max(0, pointCount - 1), lastVisibleIndex);
  buffers.geometry.instanceCount = 0;
  if (count === 0) return;

  const positions = buffers.positions.array;
  const colors = buffers.colors.array;
  let written = 0;
  for (let i = 0; i < count; i++) {
    const leftSampleIndex = Math.floor((lastVisibleIndex - i - 1) / subdivisions);
    if (samples[leftSampleIndex + 1]?.breakBefore) continue;
    const start = visualPositionInto(buffers.scratchStart, samples, lastVisibleIndex - i, subdivisions);
    const end = visualPositionInto(buffers.scratchEnd, samples, lastVisibleIndex - i - 1, subdivisions);
    const offset = written++ * 6;
    positions[offset] = (start.x - origin.x) * kmToUnit;
    positions[offset + 1] = (start.y - origin.y) * kmToUnit;
    positions[offset + 2] = (start.z - origin.z) * kmToUnit;
    positions[offset + 3] = (end.x - origin.x) * kmToUnit;
    positions[offset + 4] = (end.y - origin.y) * kmToUnit;
    positions[offset + 5] = (end.z - origin.z) * kmToUnit;

    const startAlpha = 1 - i / count;
    const endAlpha = 1 - (i + 1) / count;
    colors[offset] = color.r * startAlpha;
    colors[offset + 1] = color.g * startAlpha;
    colors[offset + 2] = color.b * startAlpha;
    colors[offset + 3] = color.r * endAlpha;
    colors[offset + 4] = color.g * endAlpha;
    colors[offset + 5] = color.b * endAlpha;
  }
  buffers.geometry.instanceCount = written;
  if (written === 0) return;

  // WebGL clears updateRanges after uploading. Reuse our range objects even
  // when a line was not rendered on the preceding frame.
  buffers.positionRange.count = written * 6;
  buffers.colorRange.count = written * 6;
  buffers.positions.updateRanges.length = 1;
  buffers.positions.updateRanges[0] = buffers.positionRange;
  buffers.colors.updateRanges.length = 1;
  buffers.colors.updateRanges[0] = buffers.colorRange;
  buffers.positions.needsUpdate = true;
  buffers.colors.needsUpdate = true;
}
