import { render } from '@testing-library/react';
import { useFrame, type RootState } from '@react-three/fiber';
import { Line2 } from 'three-stdlib';
import { InterleavedBufferAttribute, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KM_TO_UNIT } from '@/lib/scales';
import { clockRuntime } from '@/lib/time/clockRuntime';
import { useSolarStore } from '@/store/solarStore';
import { DynamicTrailLine } from './DynamicTrailLine';

vi.mock('@react-three/fiber', () => ({ useFrame: vi.fn() }));
vi.mock('@react-three/drei', async () => {
  const { forwardRef, useImperativeHandle, useMemo } = await import('react');
  const { Line2 } = await import('three-stdlib');
  return {
    Line: forwardRef<Line2>(function TestLine(_props, ref) {
      const line = useMemo(() => new Line2(), []);
      useImperativeHandle(ref, () => {
        mountedLine = line;
        return line;
      }, [line]);
      return null;
    }),
  };
});

let mountedLine: Line2;
const initialOrigin = useSolarStore.getState().renderOrigin;
const initialTime = clockRuntime.getTimeMs();
const remoteKm = 4_500_000_000;
const samples = [
  { timestampMs: 0, point: { x: remoteKm, y: 0.25, z: 0 } },
  { timestampMs: 1000, point: { x: remoteKm + 4.5, y: 1.75, z: 0.5 } },
  { timestampMs: 2000, point: { x: remoteKm + 8.25, y: 3.5, z: 1.25 } },
];

function frame() {
  vi.mocked(useFrame).mock.calls.at(-1)![0]({} as RootState, 1 / 60);
}

function getAttribute(name: string) {
  return mountedLine.geometry.getAttribute(name) as InterleavedBufferAttribute;
}

function renderedEndpoint(attribute: InterleavedBufferAttribute) {
  mountedLine.updateMatrixWorld(true);
  return mountedLine.localToWorld(new Vector3(attribute.getX(0), attribute.getY(0), attribute.getZ(0)));
}

describe('DynamicTrailLine render origin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSolarStore.setState({ renderOrigin: { x: 0, y: 0, z: 0 } });
  });

  afterEach(() => {
    clockRuntime.setTimeMs(initialTime);
    useSolarStore.setState({ renderOrigin: initialOrigin });
    mountedLine.geometry.dispose();
    mountedLine.material.dispose();
  });

  it('moves an astronomical trail without scheduling position or color uploads at the same cutoff', () => {
    clockRuntime.setTimeMs(1500);
    render(<DynamicTrailLine samples={samples} maxTrailPoints={8} color="white" graceMs={0} />);
    frame();

    const start = getAttribute('instanceStart');
    const end = getAttribute('instanceEnd');
    const colors = getAttribute('instanceColorStart').data;
    const positions = start.data;
    const positionsVersion = positions.version;
    const colorsVersion = colors.version;
    const initialPositions = Array.from(positions.array);
    const initialColors = Array.from(colors.array);
    positions.clearUpdateRanges();
    colors.clearUpdateRanges();

    expect(renderedEndpoint(start).x).toBeCloseTo(samples[1].point.x * KM_TO_UNIT, 3);
    useSolarStore.setState({ renderOrigin: { x: remoteKm + 4, y: 1, z: 0.25 } });
    frame();

    expect(positions.version).toBe(positionsVersion);
    expect(colors.version).toBe(colorsVersion);
    expect(positions.updateRanges).toEqual([]);
    expect(colors.updateRanges).toEqual([]);
    expect(Array.from(positions.array)).toEqual(initialPositions);
    expect(Array.from(colors.array)).toEqual(initialColors);
    expect(mountedLine.geometry.instanceCount).toBe(1);
    const head = renderedEndpoint(start);
    const tail = renderedEndpoint(end);
    expect(head.x).toBeCloseTo(0.5 * KM_TO_UNIT, 12);
    expect(head.y).toBeCloseTo(0.75 * KM_TO_UNIT, 12);
    expect(head.z).toBeCloseTo(0.25 * KM_TO_UNIT, 12);
    expect(tail.x).toBeCloseTo(-4 * KM_TO_UNIT, 12);
  });

  it('rebuilds at a new cutoff, then hides the trail on a reverse seek before the first edge', () => {
    clockRuntime.setTimeMs(1000);
    useSolarStore.setState({ renderOrigin: { x: remoteKm, y: 0, z: 0 } });
    render(<DynamicTrailLine samples={samples} maxTrailPoints={8} color="white" graceMs={0} />);
    frame();
    const start = getAttribute('instanceStart');
    const firstVersion = start.data.version;
    expect(mountedLine.geometry.instanceCount).toBe(1);

    clockRuntime.setTimeMs(2000);
    frame();
    expect(mountedLine.geometry.instanceCount).toBe(2);
    expect(start.data.version).toBeGreaterThan(firstVersion);
    expect(renderedEndpoint(start).x).toBeCloseTo(8.25 * KM_TO_UNIT, 12);

    clockRuntime.setTimeMs(0);
    frame();
    expect(mountedLine.visible).toBe(false);
    expect(mountedLine.geometry.instanceCount).toBe(0);
  });
});
