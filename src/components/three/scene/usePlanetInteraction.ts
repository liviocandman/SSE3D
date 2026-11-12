import type { EphemerisData, PlanetSelection } from '@/lib/types';
import type { ViewMode } from '@/lib/scales';
import { resolveCoveredTargetPosition } from '@/lib/simulation/frameResolvers';
import { buildTrajectorySegments } from '@/lib/trajectoryEngine';
import { clockRuntime } from '@/lib/time/clockRuntime';
import { getRadius } from '@/lib/scales';
import { getPlanetConfig, PLANET_MOONS } from '@/lib/textureConfig';

interface UsePlanetInteractionOptions {
  ephemerisById: Record<string, EphemerisData>;
  setSelectedPlanet: (planet: PlanetSelection | null) => void;
  resetTravel: () => void;
  setViewMode: (mode: ViewMode) => void;
  setTravelTarget: (position: { x: number; y: number; z: number }, radius: number) => void;
}

export function usePlanetInteraction({
  ephemerisById,
  setSelectedPlanet,
  resetTravel,
  setViewMode,
  setTravelTarget,
}: UsePlanetInteractionOptions) {
  const handlePlanetClick = (bodyId: string) => {
    resetTravel();
    const planet = ephemerisById[bodyId];

    if (planet) {
      const config = getPlanetConfig(planet.bodyId);
      setSelectedPlanet({
        bodyId: planet.bodyId,
        name: config?.name || planet.name,
        englishName: config?.englishName || planet.name,
      });
    }
  };

  const handlePlanetDoubleClick = (bodyId: string) => {
    const planet = ephemerisById[bodyId];

    if (planet) {
      handlePlanetClick(bodyId);
      const fallback = buildTrajectorySegments(planet.trajectory ?? [], bodyId);
      const position = resolveCoveredTargetPosition(bodyId, clockRuntime.getTimeMs(), fallback);
      if (!position) return;

      const config = getPlanetConfig(planet.bodyId);
      const realisticRadius = getRadius(planet.bodyId, config?.bodyClass || 'ROCKY_PLANET', 'realistic');
      const moonSystemMultiplier = PLANET_MOONS[planet.bodyId] ? 5 : 1;
      const cameraRadius = realisticRadius * moonSystemMultiplier;

      setViewMode('realistic');
      setTravelTarget(position, cameraRadius);
    }
  };

  return { handlePlanetClick, handlePlanetDoubleClick };
}
