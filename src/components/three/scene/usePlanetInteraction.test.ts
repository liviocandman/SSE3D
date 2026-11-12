import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePlanetInteraction } from './usePlanetInteraction';
import { useSolarStore } from '@/store/solarStore';
import { clockRuntime } from '@/lib/time/clockRuntime';
import { buildTrajectorySegment, buildTrajectorySegments } from '@/lib/trajectoryEngine';
import type { EphemerisData } from '@/lib/types';

const START = Date.parse('2026-01-01T00:00:00Z');
const planet: EphemerisData = {
  bodyId: '499', name: 'Mars', timestamp: new Date(START).toISOString(),
  position: { x: 100, y: 0, z: 0 },
  trajectory: [0, 10].map((seconds) => ({
    timestamp: new Date(START + seconds * 1000).toISOString(),
    position: { x: 100 + seconds * 10, y: 0, z: 0 },
    velocity: { x: 10, y: 0, z: 0 },
  })),
};

describe('planet interaction', () => {
  beforeEach(() => {
    clockRuntime.setTimeMs(START + 5000);
    useSolarStore.setState({ masterTrajectorySegments: {} });
  });

  function interaction(data = planet) {
    const options = {
      ephemerisById: { '499': data }, setSelectedPlanet: vi.fn(),
      resetTravel: vi.fn(), setViewMode: vi.fn(), setTravelTarget: vi.fn(),
    };
    const { result } = renderHook(() => usePlanetInteraction(options));
    return { ...options, ...result.current };
  }

  it('stores only stable selection metadata on click', () => {
    const { handlePlanetClick, setSelectedPlanet, resetTravel } = interaction();
    handlePlanetClick('499');
    expect(resetTravel).toHaveBeenCalledOnce();
    expect(setSelectedPlanet).toHaveBeenCalledWith({ bodyId: '499', name: 'Marte', englishName: 'Mars' });
  });

  it('targets the current trajectory position on double click even with a stale payload', () => {
    const authoritative = planet.trajectory!.map((point) => ({ ...point, position: { ...point.position, x: point.position.x + 1000 } }));
    useSolarStore.setState({ masterTrajectorySegments: { '499': [buildTrajectorySegment(authoritative)!] } });
    const { handlePlanetDoubleClick, setTravelTarget, setViewMode } = interaction();
    handlePlanetDoubleClick('499');
    expect(setTravelTarget).toHaveBeenCalledWith(expect.objectContaining({ x: 1150, y: 0, z: 0 }), expect.any(Number));
    expect(setViewMode).toHaveBeenCalledWith('realistic');
  });

  it('samples the payload trajectory at the current instant while the master buffer is empty', () => {
    const { handlePlanetDoubleClick, setTravelTarget } = interaction();
    handlePlanetDoubleClick('499');
    expect(setTravelTarget).toHaveBeenCalledWith(expect.objectContaining({ x: 150, y: 0, z: 0 }), expect.any(Number));
  });

  it.each([-1, 11])('does not travel to a clamped payload endpoint at second %i', (seconds) => {
    clockRuntime.setTimeMs(START + seconds * 1000);
    const { handlePlanetDoubleClick, setTravelTarget, setSelectedPlanet, resetTravel, setViewMode } = interaction();
    handlePlanetDoubleClick('499');
    expect(setTravelTarget).not.toHaveBeenCalled();
    expect(setSelectedPlanet).toHaveBeenCalledWith({ bodyId: '499', name: 'Marte', englishName: 'Mars' });
    expect(resetTravel).toHaveBeenCalledOnce();
    expect(setViewMode).not.toHaveBeenCalled();
  });

  it('preserves selection without using the static payload position when trajectories are absent', () => {
    const { handlePlanetDoubleClick, setTravelTarget, setSelectedPlanet } = interaction({ ...planet, trajectory: undefined });
    handlePlanetDoubleClick('499');
    expect(setTravelTarget).not.toHaveBeenCalled();
    expect(setSelectedPlanet).toHaveBeenCalledWith(expect.objectContaining({ bodyId: '499' }));
  });

  it('does not bypass a master-buffer gap with an older payload trajectory', () => {
    const points = [0, 1, 2, 8, 9, 10].map((seconds) => ({
      timestamp: new Date(START + seconds * 1000).toISOString(),
      position: { x: 1000 + seconds, y: 0, z: 0 },
    }));
    useSolarStore.setState({ masterTrajectorySegments: { '499': buildTrajectorySegments(points, '499') } });
    const { handlePlanetDoubleClick, setTravelTarget } = interaction();
    handlePlanetDoubleClick('499');
    expect(setTravelTarget).not.toHaveBeenCalled();
  });

  it.each([0, 10])('accepts an exact covered endpoint at second %i', (seconds) => {
    clockRuntime.setTimeMs(START + seconds * 1000);
    const { handlePlanetDoubleClick, setTravelTarget } = interaction();
    handlePlanetDoubleClick('499');
    expect(setTravelTarget).toHaveBeenCalledWith({ x: 100 + seconds * 10, y: 0, z: 0 }, expect.any(Number));
  });
});
