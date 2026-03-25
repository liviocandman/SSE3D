'use client';

import { Suspense, ReactNode, useRef, useMemo } from 'react';
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
import * as THREE from 'three';
import { useSolarStore } from '@/store/solarStore';
import { useShallow } from 'zustand/react/shallow';

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
      {/* Parameters: radius, tube, radialSegments, tubularSegments */}
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

// --- Constants ---

const CAMERA_CONFIG = {
  position: [0, 200, 500] as [number, number, number],
  fov: 45,
  near: 0.01, // Small enough for close-ups but not too small (prevents z-fighting)
  far: 50000,
};

const SUN_BODY_ID = '10';

const SEGMENTS_BY_TIER: Record<string, number> = {
  high: 64,
  mid: 48,
  low: 24,
};

/**
 * Calculates real distance from Sun in million km
 * Since 1 unit = 1M km, this is just the magnitude of the position vector
 */
function calculateMillionKmFromSun(position: [number, number, number]): number {
  const [x, y, z] = position;
  return Math.sqrt(x * x + y * y + z * z);
}

// --- Inner Scene Component ---

function SceneContent({
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
    }))
  );

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

  // Handle planet click - lookup by bodyId for reliable matching
  const handlePlanetClick = (bodyId: string) => {
    // Find the planet by bodyId (more reliable than name)
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
        velocity: planet.velocity, // km/s from NASA API
        radius: planet.radius,
        distanceFromSun: planet.distanceFromSun,
      };
      console.log('[SceneManager] Planet clicked:', selected.englishName);
      setSelectedPlanet(selected);
    }
  };

  // Handle planet double-click - travel to planet
  const handlePlanetDoubleClick = (bodyId: string) => {
    const planet = planetsToRender.find(p => p?.bodyId === bodyId);

    if (planet) {
      // Always use realistic radius for camera zoom since we switch to realistic mode
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
        radius: cameraRadius, // Include moon system framing offset where applicable
        distanceFromSun: planet.distanceFromSun,
      };
      console.log('[SceneManager] Planet double-clicked:', selected.englishName, 'camera radius:', cameraRadius);
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
        // Click on empty space = deselect
        setSelectedPlanet(null);
      }}
    >
      <ambientLight intensity={0.25} color="#b0b0b0" />

      {/* Bloom postprocessing for Sun glow effect */}
      <EffectComposer>
        <Bloom
          intensity={2.5}
          luminanceThreshold={0.6}
          luminanceSmoothing={0.9}
          mipmapBlur
          color="#ffffffff"
        />
      </EffectComposer>

      {/* Stars background */}
      <Stars
        radius={4000} // Expanded for larger scale
        depth={300}
        count={tier === 'low' ? 2000 : 5000}
        factor={10}
        fade
        speed={0.5}
      />

      {/* Orbit controls for navigation */}
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

      {/* Sun at center */}
      <Sun viewMode={viewMode} />

      {/* Keplerian orbital path lines - ellipses with Sun at focus */}
      {planetsToRender.map((planet) => {
        if (!planet) return null;
        const config = getPlanetConfig(planet.bodyId);
        if (!config) return null;

        // Calculate semi-major axis from meanDistanceAU (1 AU = 149.6 scene units)
        const semiMajorAxis = config.meanDistanceAU * AU_TO_UNIT;

        return (
          <OrbitLine
            key={`orbit-${planet.bodyId}`}
            semiMajorAxis={semiMajorAxis}
            eccentricity={config.eccentricity}
            inclination={config.orbitalInclination}
            longAscNode={config.longAscNode}
            longPerihelion={config.longPerihelion}
            opacity={getOrbitOpacity(planet.distanceFromSun)}
            color="#a3cffe"
            viewMode={viewMode}
          />
        );
      })}

      {/* Dynamically render all planets from ephemeris data */}
      {planetsToRender.map((planet) => {
        if (!planet) return null;
        return (
          <group key={planet.bodyId}>
            <CelestialBody
              bodyId={planet.bodyId}
              name={planet.name}
              englishName={planet.englishName}
              position={planet.position}
              radius={planet.radius}
              textureUrl={planet.texturePath}
              rotationSpeed={planet.rotationSpeed}
              segments={planet.segments}
              onClick={handlePlanetClick}
              onDoubleClick={handlePlanetDoubleClick}
              viewMode={viewMode}
            />
            {PLANET_MOONS[planet.bodyId] &&
              (selectedPlanet?.bodyId === planet.bodyId ||
               selectedPlanet?.parentId === planet.bodyId) && (
              <MoonSystem
                parentId={planet.bodyId}
                parentClass={planet.bodyClass}
                parentPosition={planet.position}
                date={currentDate}
                viewMode={viewMode}
                tier={tier}
              />
            )}
          </group>
        );
      })}

      {/* Selection Ring */}
      {selectedPlanetData && (
        <SelectionRing
          position={selectedPlanetData.position}
          radius={selectedPlanetData.radius}
        />
      )}

      <CameraController targetPosition={travelTarget} targetRadius={travelTargetRadius} />

      {/* Additional scene content */}
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
      <div
        className="fixed inset-0 overflow-hidden bg-[#000]"
      >
        <Suspense fallback={<LoadingScreen />}>
          <SceneContent
            ephemerisData={ephemerisData}
          >
            {children}
          </SceneContent>
        </Suspense>
      </div>
    </QualityTierProvider>
  );
}
