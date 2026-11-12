'use client';

import { useFullOrbits } from '@/hooks/useFullOrbits';
import { useQualityTier } from '@/contexts/QualityTierContext';
import { useSolarStore } from '@/store/solarStore';
import { useShallow } from 'zustand/react/shallow';
import { Sun } from './Sun';
import { CelestialBody } from './CelestialBody';
import { MoonSystem } from './MoonSystem';
import { SelectionRing } from './SelectionRing';
import { PlanetTrajectoryGroup } from './PlanetTrajectoryGroup';
import { usePlanetsToRender, SUN_BODY_ID } from './scene/usePlanetsToRender';
import { usePlanetInteraction } from './scene/usePlanetInteraction';
import { PLANET_MOONS } from '@/lib/textureConfig';
import { BODY_IDS } from '@/lib/types';
import type { EphemerisData } from '@/lib/types';

const ALL_PLANET_IDS = [
  BODY_IDS.MERCURY, BODY_IDS.VENUS, BODY_IDS.EARTH, BODY_IDS.MARS,
  BODY_IDS.JUPITER, BODY_IDS.SATURN, BODY_IDS.URANUS, BODY_IDS.NEPTUNE, BODY_IDS.PLUTO
];

interface SolarSystemLayerProps {
  ephemerisData?: EphemerisData[];
}

export function SolarSystemLayer({ ephemerisData }: SolarSystemLayerProps) {
  const { tier } = useQualityTier();

  const {
    selectedPlanet,
    setSelectedPlanet,
    viewMode,
    setViewMode,
    setTravelTarget,
    resetTravel,
  } = useSolarStore(
    useShallow((state) => ({
      selectedPlanet: state.selectedPlanet,
      setSelectedPlanet: state.setSelectedPlanet,
      viewMode: state.viewMode,
      setViewMode: state.setViewMode,
      setTravelTarget: state.setTravelTarget,
      resetTravel: state.resetTravel,
    }))
  );

  useFullOrbits(ALL_PLANET_IDS);

  const { planetsToRender, ephemerisById } = usePlanetsToRender(ephemerisData, tier, viewMode);

  const { handlePlanetClick, handlePlanetDoubleClick } = usePlanetInteraction({
    ephemerisById,
    setSelectedPlanet,
    resetTravel,
    setViewMode,
    setTravelTarget,
  });

  const selectedPlanetData = selectedPlanet
    ? planetsToRender.find(p => p?.bodyId === selectedPlanet.bodyId)
    : null;

  const sunEphemeris = ephemerisById[SUN_BODY_ID] ?? null;
  const sunAbsolutePositionKm = sunEphemeris
    ? {
      x: sunEphemeris.position.x,
      y: sunEphemeris.position.y,
      z: sunEphemeris.position.z,
    }
    : { x: 0, y: 0, z: 0 };

  return (
    <>
      <Sun viewMode={viewMode} absolutePositionKm={sunAbsolutePositionKm} />

      {planetsToRender.map((planet) => {
        if (!planet) return null;
        return (
          <PlanetTrajectoryGroup
            key={`orbit-group-${planet.bodyId}`}
            bodyId={planet.bodyId}
          />
        );
      })}

      {planetsToRender.map((planet) => {
        if (!planet) return null;
        return (
          <group key={planet.bodyId}>
            <CelestialBody
              bodyId={planet.bodyId}
              name={planet.name}
              englishName={planet.englishName}
              position={planet.position}
              trajectory={planet.trajectory}
              radius={planet.radius}
              textureUrl={planet.texturePath}
              rotationSpeed={planet.rotationSpeed}
              axialTilt={planet.axialTilt}
              dayLength={planet.dayLength}
              segments={planet.segments}
              onClick={handlePlanetClick}
              onDoubleClick={handlePlanetDoubleClick}
              viewMode={viewMode}
            >
              {PLANET_MOONS[planet.bodyId] &&
                (selectedPlanet?.bodyId === planet.bodyId ||
                  selectedPlanet?.parentId === planet.bodyId) && (
                  // MoonSystem is a child of CelestialBody, so [0,0,0] is the
                  // parent body's render-relative origin for local moon placement.
                  <MoonSystem
                    parentId={planet.bodyId}
                    parentClass={planet.bodyClass}
                    parentPosition={[0, 0, 0]}
                    worldParentPositionKm={{
                      x: ephemerisById[planet.bodyId]?.position.x ?? 0,
                      y: ephemerisById[planet.bodyId]?.position.y ?? 0,
                      z: ephemerisById[planet.bodyId]?.position.z ?? 0,
                    }}
                    viewMode={viewMode}
                    tier={tier}
                  />
                )}
              {selectedPlanetData?.bodyId === planet.bodyId && (
                <SelectionRing
                  position={[0, 0, 0]}
                  radius={selectedPlanetData.radius}
                />
              )}
            </CelestialBody>
          </group>
        );
      })}
    </>
  );
}
