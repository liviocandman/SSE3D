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
} from '@/lib/trajectoryEngine';
import type { EphemerisData, SelectedPlanet, EphemerisTrajectory } from '@/lib/types';
import {
  getPlanetConfig,
  getTexturePath,
  PLANET_MOONS,
  TextureTier,
} from '@/lib/textureConfig';
import { getRadius, scalePositionFromKm } from '@/lib/scales';
import { CameraController } from '@/hooks/useCameraAnimation';
import * as THREE from 'three';
import { useSolarStore } from '@/store/solarStore';
import { useShallow } from 'zustand/react/shallow';
import { TrajectoryManager } from './TrajectoryManager';
import { KM_TO_UNIT } from '@/lib/scales';
import StaticOrbitLine from './StaticOrbitLine';
import DynamicTrailLine from './DynamicTrailLine';
import { BODY_IDS } from '@/lib/types';

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

const SELECTION_GEOMETRY = new THREE.TorusGeometry(1, 0.005, 16, 100);

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
    <mesh ref={meshRef} position={position} rotation={[Math.PI / 2, 0, 0]} geometry={SELECTION_GEOMETRY}>
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

const ALL_PLANET_IDS = [
  BODY_IDS.MERCURY, BODY_IDS.VENUS, BODY_IDS.EARTH, BODY_IDS.MARS,
  BODY_IDS.JUPITER, BODY_IDS.SATURN, BODY_IDS.URANUS, BODY_IDS.NEPTUNE, BODY_IDS.PLUTO
];

const TRAIL_GRACE_MS = 12 * 60 * 60 * 1000;


function parseTimestampMs(timestamp: string): number {
  const utcString = timestamp.includes('Z') ? timestamp : `${timestamp}Z`;
  return new Date(utcString).getTime();
}

interface PlanetTrajectoryGroupProps {
  segments: TrajectorySegment[];
  fullOrbitData?: EphemerisTrajectory[];
}


function PlanetTrajectoryGroup({ segments, fullOrbitData }: PlanetTrajectoryGroupProps) {
  const { tier } = useQualityTier();
  const maxTrailPoints = tier === 'high' ? 240 : tier === 'mid' ? 120 : 60;
  const allPoints = useMemo(() => flattenTrajectorySegments(segments), [segments]);

  const samples = useMemo(() => {
    return allPoints.map((p) => ({
      timestampMs: parseTimestampMs(p.timestamp),
      point: new THREE.Vector3(
        p.position.x * KM_TO_UNIT,
        p.position.y * KM_TO_UNIT,
        p.position.z * KM_TO_UNIT
      ),
    })).filter((s, i, arr) => {
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
    selectedPlanet,
    setSelectedPlanet,
    viewMode,
    setViewMode,
    travelTarget,
    travelTargetRadius,
    setTravelTarget,
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
      dpr={[1, settings.devicePixelRatio]}
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
                    worldParentPosition={planet.position}
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
