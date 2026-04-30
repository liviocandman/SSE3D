'use client';

import { useMemo, useEffect } from 'react';
import { useQualityTier } from '@/contexts/QualityTierContext';
import { useSolarStore } from '@/store/solarStore';
import { useMissionStore } from '@/store/missionStore';
import { useShallow } from 'zustand/react/shallow';
import { Sun } from './Sun';
import { CelestialBody } from './CelestialBody';
import { MoonSystem } from './MoonSystem';
import { SelectionRing } from './SelectionRing';
import { PlanetTrajectoryGroup } from './PlanetTrajectoryGroup';
import { EarthMissionLayer } from './EarthMissionLayer';
import { usePlanetsToRender, SUN_BODY_ID, calculateMillionKmFromSun } from './scene/usePlanetsToRender';
import { usePlanetInteraction } from './scene/usePlanetInteraction';
import { PLANET_MOONS } from '@/lib/textureConfig';
import { BODY_IDS } from '@/lib/types';
import type { EphemerisData, SelectedPlanet } from '@/lib/types';

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
    fullOrbits,
    appendFullOrbits,
  } = useSolarStore(
    useShallow((state) => ({
      selectedPlanet: state.selectedPlanet,
      setSelectedPlanet: state.setSelectedPlanet,
      viewMode: state.viewMode,
      setViewMode: state.setViewMode,
      setTravelTarget: state.setTravelTarget,
      resetTravel: state.resetTravel,
      fullOrbits: state.fullOrbits,
      appendFullOrbits: state.appendFullOrbits,
    }))
  );

  const { setSelectedMissionTargetId } = useMissionStore(
    useShallow((state) => ({
      setSelectedMissionTargetId: state.setSelectedMissionTargetId,
    }))
  );

  // Load 100% accurate full-cycle NASA orbits on mount
  useEffect(() => {
    const fetchFullOrbits = async () => {
      const missingIds = ALL_PLANET_IDS.filter((id) => !fullOrbits[id]);
      if (missingIds.length === 0) return;

      try {
        const resp = await fetch(`/api/ephemeris?ids=${missingIds.join(',')}&fullOrbit=true`);
        if (!resp.ok) throw new Error('Failed to fetch full orbits');
        const result = await resp.json();
        appendFullOrbits(result.data);
      } catch (err) {
        console.error('Error fetching full orbits:', err);
      }
    };

    fetchFullOrbits();
  }, [appendFullOrbits, fullOrbits]);

  const { planetsToRender, ephemerisById } = usePlanetsToRender(ephemerisData, tier, viewMode);

  const { handlePlanetClick, handlePlanetDoubleClick } = usePlanetInteraction({
    ephemerisById,
    viewMode,
    setSelectedPlanet,
    setSelectedMissionTargetId,
    resetTravel,
    setViewMode,
    setTravelTarget,
  });

  const selectedPlanetData = selectedPlanet
    ? planetsToRender.find(p => p?.bodyId === selectedPlanet.bodyId)
    : null;

  const earthEphemeris = ephemerisById[BODY_IDS.EARTH] ?? null;
  const earthPlanet = planetsToRender.find((planet) => planet?.bodyId === BODY_IDS.EARTH) ?? null;
  const sunEphemeris = ephemerisById[SUN_BODY_ID] ?? null;
  const sunAbsolutePositionKm = sunEphemeris
    ? {
      x: sunEphemeris.position.x,
      y: sunEphemeris.position.y,
      z: sunEphemeris.position.z,
    }
    : { x: 0, y: 0, z: 0 };
  const isEarthMissionContextActive = selectedPlanet?.bodyId === BODY_IDS.EARTH;

  const earthSelectionContext = useMemo<SelectedPlanet | null>(() => {
    if (!earthPlanet || !earthEphemeris) return null;

    return {
      bodyId: earthPlanet.bodyId,
      name: earthPlanet.name,
      englishName: earthPlanet.englishName,
      position: {
        x: earthEphemeris.position.x,
        y: earthEphemeris.position.y,
        z: earthEphemeris.position.z,
      },
      velocity: earthEphemeris.velocity,
      radius: earthPlanet.radius,
      distanceFromSun: calculateMillionKmFromSun([
        earthEphemeris.position.x,
        earthEphemeris.position.y,
        earthEphemeris.position.z,
      ]),
      trajectory: earthEphemeris.trajectory,
    };
  }, [earthEphemeris, earthPlanet]);

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
              {planet.bodyId === BODY_IDS.EARTH && (
                // Mission visuals are Earth-local children; Earth's CelestialBody
                // transform applies renderOrigin for Orion, trajectory, and markers.
                <EarthMissionLayer
                  earthSelectionContext={earthSelectionContext}
                  earthEphemeris={earthEphemeris}
                  isEarthMissionContextActive={isEarthMissionContextActive}
                  setSelectedPlanet={setSelectedPlanet}
                />
              )}
            </CelestialBody>
          </group>
        );
      })}
    </>
  );
}
