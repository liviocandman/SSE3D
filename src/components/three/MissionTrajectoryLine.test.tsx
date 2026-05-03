import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MissionTrajectoryLine } from './MissionTrajectoryLine';
import { densifyWithCatmullRom } from '@/lib/catmullRom';
import { MissionTrajectorySegment, type MissionTrajectoryPoint } from '@/lib/missionTypes';
import type { ForwardedRef } from 'react';

// Mock scales
vi.mock('@/lib/scales', () => ({
  scalePositionFromKm: (x: number, y: number, z: number) => [x / 1000, y / 1000, z / 1000],
  KM_TO_UNIT: 0.001,
}));

// Mock catmullRom
vi.mock('@/lib/catmullRom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catmullRom')>();
  return {
    ...actual,
    densifyWithCatmullRom: vi.fn(actual.densifyWithCatmullRom),
  };
});

// Mock solarStore
vi.mock('@/store/solarStore', () => {
  return {
    useSolarStore: {
      getState: vi.fn(() => ({
        currentTime: new Date('2026-01-01T01:00:00Z'),
        renderOrigin: { x: 0, y: 0, z: 0 },
      })),
    },
  };
});

// Mock fiber
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

// Mock drei
type MockLineProps = {
  points?: unknown;
  dashed?: boolean;
  visible?: boolean;
};

vi.mock('@react-three/drei', async () => {
  const ReactModule = await import('react');
  const { createElement, forwardRef } = ReactModule;

  return {
    Line: forwardRef(function MockLine({ points, dashed, visible = true }: MockLineProps, ref: ForwardedRef<HTMLDivElement>) {
      return createElement('div', {
        ref,
        'data-testid': 'line',
        'data-dashed': dashed ? 'true' : 'false',
        'data-visible': visible ? 'true' : 'false',
        'data-points': JSON.stringify(points),
      });
    }),
  };
});

describe('MissionTrajectoryLine', () => {
  const mockPast = [
    { timestamp: '2026-01-01T00:00:00Z', position: { x: 1000, y: 0, z: 0 }, segment: MissionTrajectorySegment.PAST },
    { timestamp: '2026-01-01T01:00:00Z', position: { x: 2000, y: 0, z: 0 }, segment: MissionTrajectorySegment.PAST },
  ] satisfies MissionTrajectoryPoint[];
  const mockPlanned = [
    { timestamp: '2026-01-01T02:00:00Z', position: { x: 3000, y: 0, z: 0 }, segment: MissionTrajectorySegment.PLANNED },
    { timestamp: '2026-01-01T03:00:00Z', position: { x: 4000, y: 0, z: 0 }, segment: MissionTrajectorySegment.PLANNED },
  ] satisfies MissionTrajectoryPoint[];

  it('renders static base lines plus dynamic connector lines', () => {
    const { getAllByTestId } = render(
      <MissionTrajectoryLine past={mockPast} planned={mockPlanned} />
    );
    
    const lines = getAllByTestId('line');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toHaveAttribute('data-dashed', 'false');
    expect(lines[0]).toHaveAttribute('data-visible', 'true');
    expect(lines[1]).toHaveAttribute('data-dashed', 'false');
    expect(lines[1]).toHaveAttribute('data-visible', 'false');
    expect(lines[2]).toHaveAttribute('data-dashed', 'true');
    expect(lines[2]).toHaveAttribute('data-visible', 'false');
    expect(lines[3]).toHaveAttribute('data-dashed', 'true');
    expect(lines[3]).toHaveAttribute('data-visible', 'true');
  });

  it('passes full trajectory points only to static base lines', () => {
    const { getAllByTestId } = render(
      <MissionTrajectoryLine past={mockPast} planned={mockPlanned} />
    );

    const lines = getAllByTestId('line');
    expect(lines[0]).toHaveAttribute('data-points', JSON.stringify([[1, 0, 0], [2, 0, 0]]));
    expect(lines[1]).toHaveAttribute('data-points', JSON.stringify([[0, 0, 0], [0, 0, 0]]));
    expect(lines[2]).toHaveAttribute('data-points', JSON.stringify([[0, 0, 0], [0, 0, 0]]));
    expect(lines[3]).toHaveAttribute('data-points', JSON.stringify([[3, 0, 0], [4, 0, 0]]));
  });

  it('calls smoothing (densifyWithCatmullRom) when smoothing prop is true', async () => {
    const longPast = [
      { timestamp: '2026-01-01T00:00:00Z', position: { x: 0, y: 0, z: 0 }, segment: MissionTrajectorySegment.PAST },
      { timestamp: '2026-01-01T01:00:00Z', position: { x: 1000, y: 0, z: 0 }, segment: MissionTrajectorySegment.PAST },
      { timestamp: '2026-01-01T02:00:00Z', position: { x: 2000, y: 0, z: 0 }, segment: MissionTrajectorySegment.PAST },
    ] satisfies MissionTrajectoryPoint[];

    render(
      <MissionTrajectoryLine past={longPast} planned={[]} smoothing={true} />
    );
    
    expect(densifyWithCatmullRom).toHaveBeenCalled();
  });

  it('does not call smoothing when smoothing prop is false', async () => {
    vi.mocked(densifyWithCatmullRom).mockClear();

    const longPast = [
      { timestamp: '2026-01-01T00:00:00Z', position: { x: 0, y: 0, z: 0 }, segment: MissionTrajectorySegment.PAST },
      { timestamp: '2026-01-01T01:00:00Z', position: { x: 1000, y: 0, z: 0 }, segment: MissionTrajectorySegment.PAST },
      { timestamp: '2026-01-01T02:00:00Z', position: { x: 2000, y: 0, z: 0 }, segment: MissionTrajectorySegment.PAST },
    ] satisfies MissionTrajectoryPoint[];

    render(
      <MissionTrajectoryLine past={longPast} planned={[]} smoothing={false} />
    );

    expect(densifyWithCatmullRom).not.toHaveBeenCalled();
  });
});
