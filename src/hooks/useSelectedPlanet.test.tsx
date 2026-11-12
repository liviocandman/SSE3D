import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSelectedPlanet } from './useSelectedPlanet';
import { useSolarStore } from '@/store/solarStore';
import { clockRuntime } from '@/lib/time/clockRuntime';
import { buildTrajectorySegment, sampleTrajectoryAtTime } from '@/lib/trajectoryEngine';
import type { EphemerisTrajectory } from '@/lib/types';

// Exercise real Zustand subscriptions; the shared setup mocks useShallow.
vi.unmock('zustand/react/shallow');

const START = Date.parse('2026-01-01T00:00:00Z');
const MARS = { bodyId: '499', name: 'Marte', englishName: 'Mars' };

// x(t) = offset + t², v(t) = 2t. Hermite reproduces both exactly.
function trajectory(offset: number): EphemerisTrajectory[] {
  return [0, 10].map((seconds) => ({
    timestamp: new Date(START + seconds * 1000).toISOString(),
    position: { x: offset + seconds ** 2, y: 0, z: 0 },
    velocity: { x: 2 * seconds, y: 0, z: 0 },
  }));
}

function segment(offset: number) {
  return [buildTrajectorySegment(trajectory(offset))!];
}

describe('useSelectedPlanet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clockRuntime.setTimeMs(START);
    useSolarStore.setState({
      currentTime: new Date(START), timeSeekRevision: 0, selectedPlanet: MARS,
      masterTrajectorySegments: { '499': segment(150_000_000), '399': segment(100_000_000) },
    });
  });

  afterEach(() => vi.useRealTimers());

  it('samples the current runtime on click, and both bodies at the same instant in km', () => {
    clockRuntime.setTimeMs(START + 5000);
    const { result } = renderHook(() => useSelectedPlanet());
    expect(result.current.planet?.position?.x).toBeCloseTo(150_000_025);
    expect(result.current.planet?.velocity?.x).toBeCloseTo(10);
    expect(result.current.planet?.distanceFromSun).toBeCloseTo(150.000025);
    expect(result.current.earthPosition?.x).toBeCloseTo(100_000_025);
  });

  it('updates at the display cadence during forward and reverse playback without store snapshots', () => {
    const { result } = renderHook(() => useSelectedPlanet());
    const selection = useSolarStore.getState().selectedPlanet;
    for (const seconds of [7, 3]) {
      act(() => {
        clockRuntime.setTimeMs(START + seconds * 1000);
        vi.advanceTimersByTime(500);
      });
      const scene = sampleTrajectoryAtTime(useSolarStore.getState().masterTrajectorySegments['499'], START + seconds * 1000);
      expect(result.current.planet?.position).toEqual(scene?.position);
      expect(result.current.planet?.velocity?.x).toBeCloseTo(2 * seconds);
      expect(useSolarStore.getState().selectedPlanet).toBe(selection);
      expect(useSolarStore.getState().currentTime.getTime()).toBe(START);
    }
  });

  it('updates immediately on a paused seek and on corrected trajectory data', () => {
    const { result } = renderHook(() => useSelectedPlanet());
    act(() => useSolarStore.getState().setCurrentTime(new Date(START + 5000)));
    expect(result.current.planet?.position?.x).toBeCloseTo(150_000_025);
    act(() => useSolarStore.setState({
      masterTrajectorySegments: { ...useSolarStore.getState().masterTrajectorySegments, '499': segment(200_000_000) },
    }));
    expect(result.current.planet?.position?.x).toBeCloseTo(200_000_025);
  });

  it('samples a newly selected body immediately even between clock display ticks', () => {
    const { result } = renderHook(() => useSelectedPlanet());
    clockRuntime.setTimeMs(START + 8000);
    act(() => useSolarStore.getState().setSelectedPlanet({ bodyId: '399', name: 'Terra', englishName: 'Earth' }));
    expect(result.current.planet?.position?.x).toBeCloseTo(100_000_064);
  });

  it('composes moon and parent positions, retaining parent-relative distance and velocity', () => {
    useSolarStore.setState({
      selectedPlanet: { bodyId: '301', name: 'Lua', englishName: 'Moon', parentId: '399', parentName: 'Earth' },
      masterTrajectorySegments: { '301': segment(384_000), '399': segment(100_000_000) },
    });
    clockRuntime.setTimeMs(START + 5000);
    const { result } = renderHook(() => useSelectedPlanet());
    expect(result.current.planet?.position?.x).toBeCloseTo(100_384_050);
    expect(result.current.planet?.distanceToParentKm).toBeCloseTo(384_025);
    expect(result.current.planet?.velocity?.x).toBeCloseTo(10);
    expect(result.current.planet?.distanceFromSun).toBeCloseTo(100.38405);
  });

  it('clears dynamic values outside coverage and recovers when data arrives without another click', () => {
    const { result } = renderHook(() => useSelectedPlanet());
    act(() => useSolarStore.getState().setCurrentTime(new Date(START + 20_000)));
    expect(result.current.planet).toMatchObject(MARS);
    expect(result.current.planet?.position).toBeUndefined();
    expect(result.current.planet?.distanceFromSun).toBeUndefined();
    expect(result.current.planet?.velocity).toBeUndefined();
    expect(result.current.earthPosition).toBeUndefined();
    const extended = [...trajectory(150_000_000), {
      timestamp: new Date(START + 20_000).toISOString(),
      position: { x: 150_000_400, y: 0, z: 0 }, velocity: { x: 40, y: 0, z: 0 },
    }];
    act(() => useSolarStore.setState({ masterTrajectorySegments: { '499': [buildTrajectorySegment(extended)!] } }));
    expect(result.current.planet?.position?.x).toBeCloseTo(150_000_400);
  });

  it('does not present parent-relative moon coordinates as absolute when parent data is missing', () => {
    useSolarStore.setState({
      selectedPlanet: { bodyId: '301', name: 'Lua', englishName: 'Moon', parentId: '399' },
      masterTrajectorySegments: { '301': segment(384_000) },
    });
    const { result } = renderHook(() => useSelectedPlanet());
    expect(result.current.planet?.distanceToParentKm).toBe(384_000);
    expect(result.current.planet?.position).toBeUndefined();
    expect(result.current.planet?.distanceFromSun).toBeUndefined();
  });

  it('clears the panel when selection is removed', () => {
    const { result } = renderHook(() => useSelectedPlanet());
    act(() => useSolarStore.getState().setSelectedPlanet(null));
    expect(result.current.planet).toBeNull();
  });
});
