import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MissionTrajectoryLine } from './MissionTrajectoryLine';
import { densifyWithCatmullRom } from '@/lib/catmullRom';
import type { MissionTrajectoryPoint } from '@/lib/missionTypes';

// Mock scales
vi.mock('@/lib/scales', () => ({
  scalePositionFromKm: (x: number, y: number, z: number) => [x / 1000, y / 1000, z / 1000],
}));

// Mock catmullRom to track if it's called
vi.mock('@/lib/catmullRom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catmullRom')>();
  return {
    ...actual,
    densifyWithCatmullRom: vi.fn(actual.densifyWithCatmullRom),
  };
});

type MockLineProps = {
  points: unknown;
  dashed?: boolean;
};

type MockSphereProps = {
  position: unknown;
  children?: React.ReactNode;
};

// Mock drei
vi.mock('@react-three/drei', () => ({
  Line: ({ points, dashed }: MockLineProps) => (
    <div 
      data-testid="line" 
      data-dashed={dashed ? 'true' : 'false'} 
      data-points={JSON.stringify(points)} 
    />
  ),
  Sphere: ({ position, children }: MockSphereProps) => (
    <div data-testid="marker" data-position={JSON.stringify(position)}>{children}</div>
  ),
}));

describe('MissionTrajectoryLine', () => {
  const mockPast = [
    { timestamp: '2026-01-01T00:00:00Z', position: { x: 1000, y: 0, z: 0 }, segment: 'past' },
  ] satisfies MissionTrajectoryPoint[];
  const mockPlanned = [
    { timestamp: '2026-01-01T02:00:00Z', position: { x: 3000, y: 0, z: 0 }, segment: 'planned' },
  ] satisfies MissionTrajectoryPoint[];
  const mockCurrent: [number, number, number] = [2000, 0, 0];

  it('renders past and planned lines when data is provided', () => {
    const { getAllByTestId } = render(
      <MissionTrajectoryLine past={mockPast} current={mockCurrent} planned={mockPlanned} />
    );
    
    const lines = getAllByTestId('line');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveAttribute('data-dashed', 'false');
    expect(lines[1]).toHaveAttribute('data-dashed', 'true');
  });

  it('implements stitching: past ends at current, planned starts at current', () => {
    const { getAllByTestId } = render(
      <MissionTrajectoryLine past={mockPast} current={mockCurrent} planned={mockPlanned} />
    );
    
    const lines = getAllByTestId('line');
    const pastPts = JSON.parse(lines[0].getAttribute('data-points')!);
    const plannedPts = JSON.parse(lines[1].getAttribute('data-points')!);
    
    // Scaled current is [2, 0, 0]
    expect(pastPts[pastPts.length - 1]).toEqual([2, 0, 0]);
    expect(plannedPts[0]).toEqual([2, 0, 0]);
  });

  it('filters out invalid coordinates (NaN, Infinity)', () => {
    const badPast = [
      { timestamp: '2026-01-01T00:00:00Z', position: { x: NaN, y: 0, z: 0 }, segment: 'past' },
      { timestamp: '2026-01-01T00:01:00Z', position: { x: Infinity, y: 0, z: 0 }, segment: 'past' },
      { timestamp: '2026-01-01T00:02:00Z', position: { x: 1000, y: 0, z: 0 }, segment: 'past' },
    ] satisfies MissionTrajectoryPoint[];
    
    const { getAllByTestId } = render(
      <MissionTrajectoryLine past={badPast} current={mockCurrent} planned={[]} />
    );
    
    const lines = getAllByTestId('line');
    const pastPts = JSON.parse(lines[0].getAttribute('data-points')!);
    
    // Only the valid point [1, 0, 0] and the stitched current [2, 0, 0] should remain
    expect(pastPts).toHaveLength(2);
    expect(pastPts).toEqual([[1, 0, 0], [2, 0, 0]]);
  });

  it('calls smoothing (densifyWithCatmullRom) when smoothing prop is true', async () => {
    const longPast = [
      { timestamp: '2026-01-01T00:00:00Z', position: { x: 0, y: 0, z: 0 }, segment: 'past' },
      { timestamp: '2026-01-01T01:00:00Z', position: { x: 1000, y: 0, z: 0 }, segment: 'past' },
      { timestamp: '2026-01-01T02:00:00Z', position: { x: 2000, y: 0, z: 0 }, segment: 'past' },
    ] satisfies MissionTrajectoryPoint[];

    render(
      <MissionTrajectoryLine past={longPast} planned={[]} smoothing={true} />
    );
    
    expect(densifyWithCatmullRom).toHaveBeenCalled();
  });

  it('does not call smoothing when smoothing prop is false', async () => {
    vi.mocked(densifyWithCatmullRom).mockClear();

    const longPast = [
      { timestamp: '2026-01-01T00:00:00Z', position: { x: 0, y: 0, z: 0 }, segment: 'past' },
      { timestamp: '2026-01-01T01:00:00Z', position: { x: 1000, y: 0, z: 0 }, segment: 'past' },
      { timestamp: '2026-01-01T02:00:00Z', position: { x: 2000, y: 0, z: 0 }, segment: 'past' },
    ] satisfies MissionTrajectoryPoint[];

    render(
      <MissionTrajectoryLine past={longPast} planned={[]} smoothing={false} />
    );

    expect(densifyWithCatmullRom).not.toHaveBeenCalled();
  });

  it('handles empty data gracefully', () => {
    const { queryByTestId } = render(
      <MissionTrajectoryLine past={[]} planned={[]} />
    );
    
    expect(queryByTestId('line')).toBeNull();
    expect(queryByTestId('marker')).toBeNull();
  });
});
