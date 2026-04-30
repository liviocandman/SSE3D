import type { EphemerisData, SelectedPlanet } from '@/lib/types';
import type { ViewMode } from '@/lib/scales';
import { getRadius } from '@/lib/scales';
import { getPlanetConfig, PLANET_MOONS } from '@/lib/textureConfig';
import { calculateMillionKmFromSun } from './usePlanetsToRender';

interface UsePlanetInteractionOptions {
  ephemerisById: Record<string, EphemerisData>;
  viewMode: ViewMode;
  setSelectedPlanet: (planet: SelectedPlanet | null) => void;
  setSelectedMissionTargetId: (id: string | null) => void;
  resetTravel: () => void;
  setViewMode: (mode: ViewMode) => void;
  setTravelTarget: (position: { x: number; y: number; z: number }, radius: number) => void;
}

export function usePlanetInteraction({
  ephemerisById,
  viewMode,
  setSelectedPlanet,
  setSelectedMissionTargetId,
  resetTravel,
  setViewMode,
  setTravelTarget,
}: UsePlanetInteractionOptions) {
  const handlePlanetClick = (bodyId: string) => {
    setSelectedMissionTargetId(null);
    resetTravel();
    const planet = ephemerisById[bodyId];

    if (planet) {
      const config = getPlanetConfig(planet.bodyId);
      const selected: SelectedPlanet = {
        bodyId: planet.bodyId,
        name: config?.name || planet.name,
        englishName: config?.englishName || planet.name,
        position: {
          x: planet.position.x,
          y: planet.position.y,
          z: planet.position.z,
        },
        velocity: planet.velocity,
        radius: getRadius(planet.bodyId, config?.bodyClass || 'ROCKY_PLANET', viewMode),
        distanceFromSun: calculateMillionKmFromSun([planet.position.x, planet.position.y, planet.position.z]),
        trajectory: planet.trajectory,
      };
      setSelectedPlanet(selected);
    }
  };

  const handlePlanetDoubleClick = (bodyId: string) => {
    setSelectedMissionTargetId(null);
    const planet = ephemerisById[bodyId];

    if (planet) {
      const config = getPlanetConfig(planet.bodyId);
      const realisticRadius = getRadius(planet.bodyId, config?.bodyClass || 'ROCKY_PLANET', 'realistic');
      const moonSystemMultiplier = PLANET_MOONS[planet.bodyId] ? 5 : 1;
      const cameraRadius = realisticRadius * moonSystemMultiplier;

      const selected: SelectedPlanet = {
        bodyId: planet.bodyId,
        name: config?.name || planet.name,
        englishName: config?.englishName || planet.name,
        position: {
          x: planet.position.x,
          y: planet.position.y,
          z: planet.position.z,
        },
        velocity: planet.velocity,
        radius: cameraRadius,
        distanceFromSun: calculateMillionKmFromSun([planet.position.x, planet.position.y, planet.position.z]),
        trajectory: planet.trajectory,
      };
      setSelectedPlanet(selected);
      setViewMode('realistic');
      setTravelTarget(selected.position, selected.radius);
    }
  };

  return { handlePlanetClick, handlePlanetDoubleClick };
}
