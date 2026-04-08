'use client';

import { Suspense, ReactNode, useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { QualityTierProvider, useQualityTier } from '@/contexts/QualityTierContext';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { Sun } from './Sun';
import { CelestialBody } from './CelestialBody';
import { MoonSystem } from './MoonSystem';
import {
  type TrajectorySegment,
  flattenTrajectorySegments,
  buildTrajectorySegment,
} from '@/lib/trajectoryEngine';
import type { EphemerisData, SelectedPlanet, EphemerisTrajectory } from '@/lib/types';
import {
  getPlanetConfig,
  getTexturePath,
  PLANET_MOONS,
  TextureTier,
} from '@/lib/textureConfig';
import { getRadius, scalePositionFromKm, KM_TO_UNIT } from '@/lib/scales';
import { parseTimestampMs } from '@/lib/utils';
import { CameraController } from '@/hooks/useCameraAnimation';
import * as THREE from 'three';
import { useSolarStore } from '@/store/solarStore';
import { useMissionStore } from '@/store/missionStore';
import { clockRuntime } from '@/lib/time/clockRuntime';
import { useShallow } from 'zustand/react/shallow';
import { TrajectoryManager } from './TrajectoryManager';
import StaticOrbitLine from './StaticOrbitLine';
import DynamicTrailLine from './DynamicTrailLine';
import {
  SpacecraftBody,
} from './SpacecraftBody';
import { MissionTrajectoryLine } from './MissionTrajectoryLine';
import { MissionMilestoneMarker } from './MissionMilestoneMarker';
import { MissionPhase } from '@/lib/missionTypes';
import { BODY_IDS, MISSION_CONFIG, CAMERA_MODEL_V2_ORIGIN_ONLY } from '@/lib/types';

// --- Types ---

interface SceneManagerProps {
  children?: ReactNode;
  ephemerisData?: EphemerisData[];
}

interface SceneContentProps {
  children?: ReactNode;
  ephemerisData?: EphemerisData[];
}

import { TORUS_SELECTION } from '@/lib/geometryPool';

function SelectionRing({ position, radius }: { position: [number, number, number]; radius: number }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;

    // Smooth rotation
    meshRef.current.rotation.z += 0.01;

    // Subtle pulse
    const scale = (radius * 1.5) * (1 + Math.sin(state.clock.elapsedTime * 3) * 0.05);
    meshRef.current.scale.set(scale, scale, scale);
  });

  return (
    <mesh ref={meshRef} position={position} rotation={[Math.PI / 2, 0, 0]} geometry={TORUS_SELECTION} dispose={null}>
      <meshBasicMaterial
        color="#ffffff"
        transparent
        opacity={0.6}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function GlobalTimeController() {
  const lastStorePushMsRef = useRef<number | null>(null);
  const lastStoreSyncAtRef = useRef(0);

  useFrame((_, delta) => {
    const solarStore = useSolarStore.getState();
    const storeTimeMs = solarStore.currentTime.getTime();

    if (!clockRuntime.isInitialized()) {
      clockRuntime.initialize(storeTimeMs);
      lastStorePushMsRef.current = storeTimeMs;
      lastStoreSyncAtRef.current = performance.now();
      return;
    }

    const runtimeTimeMs = clockRuntime.getTimeMs();
    const wasPushedByRuntime = lastStorePushMsRef.current === storeTimeMs;
    if (!wasPushedByRuntime && Math.abs(storeTimeMs - runtimeTimeMs) > 1) {
      clockRuntime.setTimeMs(storeTimeMs);
    }

    const canAdvance = solarStore.isPlaying && solarStore.timeAuthority === 'user';
    if (canAdvance) {
      clockRuntime.tick(delta, solarStore.timeMultiplier);
    }

    const now = performance.now();
    const shouldSyncStore = now - lastStoreSyncAtRef.current >= 250;
    if (!shouldSyncStore) return;

    const nextRuntimeMs = clockRuntime.getTimeMs();
    if (Math.abs(nextRuntimeMs - storeTimeMs) > 1) {
      lastStorePushMsRef.current = nextRuntimeMs;
      solarStore.setCurrentTime(new Date(nextRuntimeMs));
    }
    lastStoreSyncAtRef.current = now;
  });
  return null;
}

// --- Constants ---

const CAMERA_CONFIG = {
  position: [0, 200, 500] as [number, number, number],
  fov: 45,
  near: 0.00001,
  far: 50000,
};

const SUN_BODY_ID = '10';

const SEGMENTS_BY_TIER: Record<string, number> = {
  high: 64,
  mid: 48,
  low: 24,
};

function calculateMillionKmFromSun(position: [number, number, number]): number {
  const [x, y, z] = position;
  return Math.sqrt(x * x + y * y + z * z) * KM_TO_UNIT;
}

const ALL_PLANET_IDS = [
  BODY_IDS.MERCURY, BODY_IDS.VENUS, BODY_IDS.EARTH, BODY_IDS.MARS,
  BODY_IDS.JUPITER, BODY_IDS.SATURN, BODY_IDS.URANUS, BODY_IDS.NEPTUNE, BODY_IDS.PLUTO
];

const TRAIL_GRACE_MS = 12 * 60 * 60 * 1000;

interface PlanetTrajectoryGroupProps {
  segments: TrajectorySegment[];
  fullOrbitData?: EphemerisTrajectory[];
}


function PlanetTrajectoryGroup({ segments, fullOrbitData }: PlanetTrajectoryGroupProps) {
  const { tier } = useQualityTier();
  const maxTrailPoints = tier === 'high' ? 240 : tier === 'mid' ? 120 : 60;
  const allPoints = useMemo(() => flattenTrajectorySegments(segments), [segments]);

  const samples = useMemo(() => {
    return allPoints.map((p) => {
      // Pass absolute KM positions
      return {
        timestampMs: parseTimestampMs(p.timestamp),
        point: new THREE.Vector3(p.position.x, p.position.y, p.position.z),
      };
    }).filter((s, i, arr) => {
      // Anti-NaN & Duplicate Shield (from TrailLine logic)
      if (!Number.isFinite(s.point.x) || !Number.isFinite(s.point.y) || !Number.isFinite(s.point.z)) {
        return false;
      }
      if (i > 0 && s.point.distanceToSquared(arr[i - 1].point) < 0.000001) {
        return false;
      }
      return true;
    });
  }, [allPoints]);

  return (
    <group>
      {fullOrbitData && (
        <StaticOrbitLine
          trajectory={fullOrbitData}
          color="#a3cffe"
          opacity={0.05}
          lineWidth={0.5}
        />
      )}

      {samples.length > 2 && (
        <DynamicTrailLine
          samples={samples}
          maxTrailPoints={maxTrailPoints}
          graceMs={TRAIL_GRACE_MS}
          color="#a3cffe"
          opacity={0.8}
          lineWidth={1.5}
        />
      )}
    </group>
  );
}

// --- Inner Scene Component ---

export function SceneContent({
  children,
  ephemerisData,
}: SceneContentProps) {
  const { tier, settings } = useQualityTier();

  const {
    missionState,
    missionTrajectory,
    missionEvents,
    estimatedAttitudeEnabled,
    selectedMissionTargetId,
    setSelectedMissionTargetId,
  } = useMissionStore(
    useShallow((state) => ({
      missionState: state.missionState,
      missionTrajectory: state.missionTrajectory,
      missionEvents: state.missionEvents,
      estimatedAttitudeEnabled: state.estimatedAttitudeEnabled,
      selectedMissionTargetId: state.selectedMissionTargetId,
      setSelectedMissionTargetId: state.setSelectedMissionTargetId,
    }))
  );

  const {
    selectedPlanet,
    setSelectedPlanet,
    viewMode,
    setViewMode,
    travelTarget,
    travelTargetRadius,
    setTravelTarget,
    resetTravel,
    masterTrajectorySegments,
    fullOrbits,
    appendFullOrbits,
  } = useSolarStore(
    useShallow((state) => ({
      selectedPlanet: state.selectedPlanet,
      setSelectedPlanet: state.setSelectedPlanet,
      viewMode: state.viewMode,
      setViewMode: state.setViewMode,
      travelTarget: state.travelTarget,
      travelTargetRadius: state.travelTargetRadius,
      setTravelTarget: state.setTravelTarget,
      resetTravel: state.resetTravel,
      masterTrajectorySegments: state.masterTrajectorySegments,
      fullOrbits: state.fullOrbits,
      appendFullOrbits: state.appendFullOrbits,
    }))
  );

  // Load 100% accurate full-cycle NASA orbits on mount
  useEffect(() => {
    const fetchFullOrbits = async () => {
      const missingIds = ALL_PLANET_IDS.filter(id => !fullOrbits[id]);
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
  }, [fullOrbits, appendFullOrbits]);

  const planetsToRender = useMemo(() => {
    if (!ephemerisData || ephemerisData.length === 0) {
      return [];
    }

    const segments = SEGMENTS_BY_TIER[tier] ?? 48;

    return ephemerisData
      .filter(body => body.bodyId !== SUN_BODY_ID)
      .map(body => {
        const config = getPlanetConfig(body.bodyId);
        if (!config) return null;

        const position = scalePositionFromKm(
          body.position.x,
          body.position.y,
          body.position.z
        );

        return {
          bodyId: body.bodyId,
          name: config.name,
          englishName: config.englishName,
          position,
          velocity: body.velocity,
          trajectory: body.trajectory,
          radius: getRadius(body.bodyId, config.bodyClass, viewMode),
          texturePath: getTexturePath(body.bodyId, tier as TextureTier),
          rotationSpeed: config.rotationSpeed,
          axialTilt: config.axialTilt,
          dayLength: config.dayLength,
          distanceFromSun: calculateMillionKmFromSun([
            body.position.x,
            body.position.y,
            body.position.z,
          ]),
          bodyClass: config.bodyClass,
          segments,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [ephemerisData, tier, viewMode]);

  const ephemerisById = useMemo(() => {
    const map: Record<string, EphemerisData> = {};
    if (!ephemerisData) return map;
    for (const body of ephemerisData) {
      map[body.bodyId] = body;
    }
    return map;
  }, [ephemerisData]);

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

  const selectedPlanetData = selectedPlanet
    ? planetsToRender.find(p => p?.bodyId === selectedPlanet.bodyId)
    : null;

  const earthPlanet = planetsToRender.find((planet) => planet?.bodyId === BODY_IDS.EARTH) ?? null;
  const earthEphemeris = ephemerisById[BODY_IDS.EARTH] ?? null;
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

  const missionTrajectorySegment = useMemo<TrajectorySegment | null>(() => {
    if (!missionTrajectory) return null;
    const combinedPoints = [...missionTrajectory.past, ...missionTrajectory.planned];
    if (combinedPoints.length < 2) return null;

    return buildTrajectorySegment(
      combinedPoints.map((point) => ({
        timestamp: point.timestamp,
        position: {
          x: point.position.x,
          y: point.position.y,
          z: point.position.z,
        },
        velocity: point.velocity
          ? {
            x: point.velocity.x,
            y: point.velocity.y,
            z: point.velocity.z,
          }
          : undefined,
      }))
    );
  }, [missionTrajectory]);

  const cameraTargetId = selectedPlanet?.bodyId || (isEarthMissionContextActive ? 'Orion' : undefined);

  // --- Event Anchor Resolution ---
  const missionMilestones = useMemo(() => {
    if (!missionEvents?.events || !missionTrajectory) return [];

    const majorPhases = [
      MissionPhase.EARTH_DEPARTURE,
      MissionPhase.LUNAR_FLYBY,
      MissionPhase.REENTRY
    ];

    const allTrajectoryPoints = [...missionTrajectory.past, ...missionTrajectory.planned];

    return missionEvents.events
      .filter(ev => majorPhases.includes(ev.phase))
      .map(ev => {
        // Find nearest point in trajectory by timestamp
        const evDate = new Date(ev.timestamp).getTime();
        if (!Number.isFinite(evDate)) return null;
        let nearestPoint = allTrajectoryPoints[0];
        let minDiff = Infinity;

        for (const pt of allTrajectoryPoints) {
          const ptDate = new Date(pt.timestamp).getTime();
          if (!Number.isFinite(ptDate)) continue;
          const diff = Math.abs(evDate - ptDate);
          if (diff < minDiff) {
            minDiff = diff;
            nearestPoint = pt;
          }
        }

        if (!nearestPoint) return null;

        // Position is Earth-relative KM
        const pos: [number, number, number] = [
          nearestPoint.position.x,
          nearestPoint.position.y,
          nearestPoint.position.z
        ];

        return {
          id: ev.id,
          label: ev.name,
          position: pos,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [missionEvents, missionTrajectory]);

  return (
    <Canvas
      camera={CAMERA_CONFIG}
      dpr={[1, settings.devicePixelRatio]}
      gl={{
        logarithmicDepthBuffer: true,
        antialias: settings.antialias,
        powerPreference: tier === 'low' ? 'low-power' : 'high-performance',
      }}
      style={{ width: '100%', height: '100%' }}
      onPointerMissed={() => {
        setSelectedPlanet(null);
        setSelectedMissionTargetId(null);
        resetTravel();
      }}
    >
      <ambientLight intensity={0.25} color="#b0b0b0" />
      <GlobalTimeController />
      <TrajectoryManager />

      {tier !== 'low' && (
        <EffectComposer enableNormalPass={false}>
          <Bloom
            intensity={tier === 'high' ? 2.5 : 1.5}
            luminanceThreshold={0.6}
            luminanceSmoothing={0.9}
            mipmapBlur={tier === 'high'}
            color="#ffffffff"
          />
        </EffectComposer>
      )}

      <Stars
        radius={50000}
        depth={300}
        count={tier === 'low' ? 2000 : 5000}
        factor={10}
        fade
        speed={0.5}
      />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.05}
        minDistance={0.00001}
        maxDistance={50000}
        enablePan={!CAMERA_MODEL_V2_ORIGIN_ONLY}
        panSpeed={1}
        rotateSpeed={1}
        zoomSpeed={3}
      />

      <Sun viewMode={viewMode} absolutePositionKm={sunAbsolutePositionKm} />

      {planetsToRender.map((planet) => {
        if (!planet) return null;
        return (
          <PlanetTrajectoryGroup
            key={`orbit-group-${planet.bodyId}`}
            segments={masterTrajectorySegments[planet.bodyId] || []}
            fullOrbitData={fullOrbits[planet.bodyId]}
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
              {planet.bodyId === BODY_IDS.EARTH && missionState && isEarthMissionContextActive && (
                <>
                  <SpacecraftBody
                    vehicleId={missionState.vehicleId}
                    label={missionState.vehicleId === 'orion' ? 'Orion' : missionState.vehicleId.toUpperCase()}
                    isSelected={selectedMissionTargetId === missionState.vehicleId}
                    attitudeQuaternion={missionState.attitudeQuaternion}
                    missionTrajectorySegment={missionTrajectorySegment}
                    earthEphemeris={earthEphemeris}
                    onClick={(id) => {
                      if (earthSelectionContext) {
                        setSelectedPlanet(earthSelectionContext);
                      }
                      setSelectedMissionTargetId(id);
                    }}
                    onDoubleClick={(id) => {
                      if (earthSelectionContext) {
                        setSelectedPlanet(earthSelectionContext);
                      }
                      setSelectedMissionTargetId(id);
                    }}
                    useAttitude={
                      MISSION_CONFIG.ENABLE_ATTITUDE &&
                      (
                        missionState.attitudeSource === 'CK_SPICE' ||
                        (MISSION_CONFIG.ENABLE_POLICY_ATTITUDE && estimatedAttitudeEnabled)
                      )
                    }
                  />

                  {missionTrajectory && (
                    <MissionTrajectoryLine
                      past={missionTrajectory.past}
                      planned={missionTrajectory.planned}
                      missionTrajectorySegment={missionTrajectorySegment}
                      smoothing={false}
                    />
                  )}
                  {/*  3D Mission Milestones */}
                  {missionMilestones.map(milestone => (
                    <MissionMilestoneMarker
                      key={milestone.id}
                      label={milestone.label}
                      position={milestone.position}
                    />
                  ))}
                </>
              )}
            </CelestialBody>
          </group>
        );
      })}

      <CameraController
        targetPositionKm={travelTarget}
        targetRadiusKm={travelTargetRadius ? travelTargetRadius / KM_TO_UNIT : undefined}
        targetId={cameraTargetId}
      />

      {children}
    </Canvas>
  );
}

// --- Main Component ---

export function SceneManager({
  children,
  ephemerisData,
}: SceneManagerProps) {
  return (
    <QualityTierProvider>
      <div className="fixed inset-0 overflow-hidden bg-[#000]">
        <Suspense fallback={<LoadingScreen />}>
          <SceneContent ephemerisData={ephemerisData}>
            {children}
          </SceneContent>
        </Suspense>
      </div>
    </QualityTierProvider>
  );
}
