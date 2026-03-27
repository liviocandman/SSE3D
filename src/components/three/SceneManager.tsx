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
import type { EphemerisData, SelectedPlanet } from '@/lib/types';
import {
  getPlanetConfig,
  getTexturePath,
  PLANET_MOONS,
  TextureTier,
} from '@/lib/textureConfig';
import { getRadius, scalePositionFromKm, AU_TO_UNIT } from '@/lib/scales';
import { CameraController } from '@/hooks/useCameraAnimation';
import { OrbitLine, getOrbitOpacity } from './OrbitLine';
import TrailLine from './TrailLine';
import * as THREE from 'three';
import { useSolarStore } from '@/store/solarStore';
import { useShallow } from 'zustand/react/shallow';
import { TrajectoryManager } from './TrajectoryManager';
import { flattenTrajectorySegments } from '@/lib/trajectoryEngine';
import { KM_TO_UNIT } from '@/lib/scales';

// --- Types ---

interface SceneManagerProps {
  children?: ReactNode;
  ephemerisData?: EphemerisData[];
}

interface SceneContentProps {
  children?: ReactNode;
  ephemerisData?: EphemerisData[];
}

// --- Helper Components ---

function SelectionRing({ position, radius }: { position: [number, number, number]; radius: number }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;

    // Smooth rotation
    meshRef.current.rotation.z += 0.01;

    // Subtle pulse
    const scale = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.05;
    meshRef.current.scale.set(scale, scale, scale);
  });

  return (
    <mesh ref={meshRef} position={position} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius * 1.5, 0.05 * (radius / 10), 16, 100]} />
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
  const advanceTime = useSolarStore(state => state.advanceTime);
  useFrame((_, delta) => {
    // This is a transient update to the store state every frame
    advanceTime(delta);
  });
  return null;
}

// --- Constants ---

const CAMERA_CONFIG = {
  position: [0, 200, 500] as [number, number, number],
  fov: 45,
  near: 0.01,
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
  return Math.sqrt(x * x + y * y + z * z);
}

import StaticOrbitLine from './StaticOrbitLine';
import { BODY_IDS } from '@/lib/types';

const ALL_PLANET_IDS = [
  BODY_IDS.MERCURY, BODY_IDS.VENUS, BODY_IDS.EARTH, BODY_IDS.MARS,
  BODY_IDS.JUPITER, BODY_IDS.SATURN, BODY_IDS.URANUS, BODY_IDS.NEPTUNE, BODY_IDS.PLUTO
];

interface PlanetTrajectoryGroupProps {
  bodyId: string;
  segments: any[]; // TrajectorySegment[]
  fullOrbitData?: any; // EphemerisTrajectory[]
  currentTime: Date;
}

/**
 * Isolated component for rendering a planet's orbit and trail.
 * Uses useMemo to avoid flattening trajectory segments every frame.
 */
function PlanetTrajectoryGroup({ bodyId, segments, fullOrbitData, currentTime }: PlanetTrajectoryGroupProps) {
  // Expensive flattening happens ONLY when segments change
  const allPoints = useMemo(() => flattenTrajectorySegments(segments), [segments]);
  const simTimeMs = currentTime.getTime();

  // Filter for PAST points (from oldest up to current time) for the 'tail' effect
  // This still runs every frame but on a pre-flattened array
  const pastPoints = useMemo(() => {
    return allPoints
      .filter((p) => {
        const t = p.timestamp.includes("Z") ? p.timestamp : `${p.timestamp}Z`;
        return new Date(t).getTime() <= simTimeMs + 3600000; // 1h grace
      })
      .map((p) => new THREE.Vector3(p.position.x * KM_TO_UNIT, p.position.y * KM_TO_UNIT, p.position.z * KM_TO_UNIT))
      .reverse();
  }, [allPoints, simTimeMs]);

  const hasTrail = pastPoints.length > 2;

  return (
    <group>
      {/* The Full NASA Orbit Path (Background) */}
      {fullOrbitData && (
        <StaticOrbitLine
          trajectory={fullOrbitData}
          color="#a3cffe"
          opacity={0.12}
        />
      )}

      {/* The Dynamic Comet Tail (Effect) */}
      {hasTrail && (
        <TrailLine
          points={pastPoints}
          color="#ffffff"
          fadeMode="tail"
          opacity={0.8}
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
    currentDate,
    selectedPlanet,
    setSelectedPlanet,
    viewMode,
    setViewMode,
    travelTarget,
    travelTargetRadius,
    setTravelTarget,
    masterTrajectorySegments,
    currentTime,
    fullOrbits,
    appendFullOrbits,
  } = useSolarStore(
    useShallow((state) => ({
      currentDate: state.currentDate,
      selectedPlanet: state.selectedPlanet,
      setSelectedPlanet: state.setSelectedPlanet,
      viewMode: state.viewMode,
      setViewMode: state.setViewMode,
      travelTarget: state.travelTarget,
      travelTargetRadius: state.travelTargetRadius,
      setTravelTarget: state.setTravelTarget,
      masterTrajectorySegments: state.masterTrajectorySegments,
      currentTime: state.currentTime,
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
          distanceFromSun: calculateMillionKmFromSun(position),
          bodyClass: config.bodyClass,
          segments,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [ephemerisData, tier, viewMode]);

  const handlePlanetClick = (bodyId: string) => {
    const planet = planetsToRender.find(p => p?.bodyId === bodyId);

    if (planet) {
      const selected: SelectedPlanet = {
        bodyId: planet.bodyId,
        name: planet.name,
        englishName: planet.englishName,
        position: {
          x: planet.position[0],
          y: planet.position[1],
          z: planet.position[2],
        },
        velocity: planet.velocity,
        radius: planet.radius,
        distanceFromSun: planet.distanceFromSun,
        trajectory: planet.trajectory,
      };
      setSelectedPlanet(selected);
    }
  };

  const handlePlanetDoubleClick = (bodyId: string) => {
    const planet = planetsToRender.find(p => p?.bodyId === bodyId);

    if (planet) {
      const realisticRadius = getRadius(planet.bodyId, planet.bodyClass, 'realistic');
      const moonSystemMultiplier = PLANET_MOONS[planet.bodyId] ? 5 : 1;
      const cameraRadius = realisticRadius * moonSystemMultiplier;

      const selected: SelectedPlanet = {
        bodyId: planet.bodyId,
        name: planet.name,
        englishName: planet.englishName,
        position: {
          x: planet.position[0],
          y: planet.position[1],
          z: planet.position[2],
        },
        velocity: planet.velocity,
        radius: cameraRadius,
        distanceFromSun: planet.distanceFromSun,
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

  return (
    <Canvas
      camera={CAMERA_CONFIG}
      dpr={settings.devicePixelRatio}
      gl={{
        antialias: settings.antialias,
        powerPreference: tier === 'low' ? 'low-power' : 'high-performance',
      }}
      style={{ width: '100%', height: '100%' }}
      onPointerMissed={() => {
        setSelectedPlanet(null);
      }}
    >
      <ambientLight intensity={0.25} color="#b0b0b0" />
      <GlobalTimeController />
      <TrajectoryManager />

      <EffectComposer>
        <Bloom
          intensity={2.5}
          luminanceThreshold={0.6}
          luminanceSmoothing={0.9}
          mipmapBlur
          color="#ffffffff"
        />
      </EffectComposer>

      <Stars
        radius={4000}
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
        minDistance={0.001}
        maxDistance={12000}
        enablePan
        panSpeed={1}
        rotateSpeed={1}
        zoomSpeed={5}
      />

      <Sun viewMode={viewMode} />

      {planetsToRender.map((planet) => {
        if (!planet) return null;
        return (
          <PlanetTrajectoryGroup
            key={`trajectory-${planet.bodyId}`}
            bodyId={planet.bodyId}
            segments={masterTrajectorySegments[planet.bodyId] || []}
            fullOrbitData={fullOrbits[planet.bodyId]}
            currentTime={currentTime}
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
                  worldParentPosition={planet.position}
                  date={currentDate}
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

      <CameraController targetPosition={travelTarget} targetRadius={travelTargetRadius} targetName={selectedPlanet?.englishName} />

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
