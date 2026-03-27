'use client';

import { useMemo, useRef, useState, Suspense } from 'react';
import { useLoader, useFrame, ThreeEvent } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import { TextureLoader } from 'three';
import * as THREE from 'three';
import { OrbitLine } from './OrbitLine';
import {
  getPlanetConfig,
  getTexturePath,
  PLANET_MOONS,
  type TextureTier,
} from '@/lib/textureConfig';
import {
  getMoonOrbitScale,
  getRadius,
  scalePositionFromKm,
  type BodyClass,
  type ViewMode,
} from '@/lib/scales';
import type { EphemerisTrajectory } from '@/lib/types';
import { useSolarStore } from '@/store/solarStore';
import { useShallow } from 'zustand/react/shallow';
import { buildTrajectorySegment, sampleTrajectoryAtTime } from '@/lib/trajectoryEngine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MoonSystemProps {
  parentId: string;
  parentClass: BodyClass;
  parentPosition: [number, number, number];
  worldParentPosition?: [number, number, number];
  date: string;
  viewMode: ViewMode;
  tier: string;
}

interface MoonMeshProps {
  bodyId: string;
  name: string;
  initialPosition: [number, number, number];
  trajectory?: EphemerisTrajectory[];
  orbitScale: number;
  radius: number;
  textureUrl: string;
  rotationSpeed: number;
  fallbackColor: string;
  viewMode: ViewMode;
  onClick: () => void;
  onDoubleClick: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AU_TO_KM = 149_597_870.7;

function resolveTextureTier(tier: string): TextureTier {
  if (tier === 'low' || tier === 'high') return tier;
  return 'mid';
}

// ---------------------------------------------------------------------------
// MoonMesh
// ---------------------------------------------------------------------------

function MoonMesh({
  bodyId,
  name,
  initialPosition,
  trajectory,
  orbitScale,
  radius,
  textureUrl,
  rotationSpeed,
  fallbackColor,
  viewMode,
  onClick,
  onDoubleClick,
}: MoonMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const [isHovered, setIsHovered] = useState(false);
  const fallbackSegments = useMemo(() => {
    if (!trajectory || trajectory.length === 0) return [];
    const segment = buildTrajectorySegment(trajectory);
    return segment ? [segment] : [];
  }, [trajectory]);

  const texture = useLoader(TextureLoader, textureUrl, (loader) => {
    loader.setCrossOrigin('anonymous');
  });

  useFrame((_, delta) => {
    const solarState = useSolarStore.getState();
    const simTime = solarState.currentTime.getTime();
    const isPlaying = solarState.isPlaying;
    const timeMultiplier = solarState.timeMultiplier;

    const segments = solarState.masterTrajectorySegments[bodyId] || fallbackSegments;

    // 1. Interpolate position
    if (segments.length > 0 && groupRef.current) {
      const SCALE = (1 / 1_000_000) * orbitScale;
      const sampled = sampleTrajectoryAtTime(segments, simTime);
      if (sampled) {
        const { x, y, z } = sampled.position;
        groupRef.current.position.set(
          x * SCALE,
          y * SCALE,
          z * SCALE
        );
      }
    }

    // 2. Rotation (Time-scaled)
    if (meshRef.current) {
      meshRef.current.rotation.y += rotationSpeed * 60 * delta * (isPlaying ? timeMultiplier : 1);
    }
  });

  const fontSize = viewMode === 'didactic' ? radius * 0.8 : radius * 12;

  const hitboxRadius = viewMode === 'realistic'
    ? Math.max(radius * 20, 0.05)
    : radius * 1.5;

  const labelY = isHovered ? radius * 1.8 : -radius * 1.8;
  const labelColor = isHovered ? '#ffffff' : '#8ab4d8';
  const labelAnchorY = isHovered ? 'bottom' : 'top';

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick();
  };
  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onDoubleClick();
  };
  const handlePointerEnter = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setIsHovered(true);
    document.body.style.cursor = 'pointer';
  };
  const handlePointerLeave = () => {
    setIsHovered(false);
    document.body.style.cursor = 'auto';
  };

  const events = {
    onClick: handleClick,
    onDoubleClick: handleDoubleClick,
    onPointerEnter: handlePointerEnter,
    onPointerLeave: handlePointerLeave,
  };

  return (
    <group name={name} ref={groupRef} position={initialPosition}>
      <mesh {...events} renderOrder={-1}>
        <sphereGeometry args={[hitboxRadius, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh ref={meshRef} {...events}>
        <sphereGeometry args={[radius, 24, 24]} />
        <meshLambertMaterial
          map={texture || null}
          color={texture ? '#ffffff' : fallbackColor}
        />
      </mesh>

      {isHovered && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius * 1.15, radius * 1.3, 32]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <Text
          position={[0, labelY, 0]}
          fontSize={fontSize}
          color={labelColor}
          anchorX="center"
          anchorY={labelAnchorY as 'top' | 'bottom'}
          outlineWidth={radius * 0.03}
          outlineColor="#000000"
        >
          {name.toUpperCase()}
        </Text>
      </Billboard>
    </group>
  );
}

// ---------------------------------------------------------------------------
// MoonSystem
// ---------------------------------------------------------------------------

export function MoonSystem({
  parentId,
  parentClass,
  parentPosition,
  worldParentPosition,
  date: _date,
  viewMode,
  tier,
}: MoonSystemProps) {
  const moonIds = PLANET_MOONS[parentId] ?? [];
  const hasMoons = moonIds.length > 0;

  const { setSelectedPlanet, setViewMode, setTravelTarget, masterTrajectory } = useSolarStore(
    useShallow((s) => ({
      setSelectedPlanet: s.setSelectedPlanet,
      setViewMode: s.setViewMode,
      setTravelTarget: s.setTravelTarget,
      masterTrajectory: s.masterTrajectory,
    }))
  );
  
  const parentConfig = getPlanetConfig(parentId);

  if (!hasMoons) return null;

  const textureTier = resolveTextureTier(tier);

  return (
    <group position={parentPosition}>
      {/* 1. Orbit Lines (Consumes trajectories from master pool) */}
      {moonIds.map((moonId) => {
        const moonTrajectory = masterTrajectory[moonId];
        const config = getPlanetConfig(moonId);
        
        if (!config || !moonTrajectory || moonTrajectory.length < 2) return null;

        const orbitScale = getMoonOrbitScale(
          parentId,
          parentClass,
          config.meanDistanceAU * AU_TO_KM,
          viewMode
        );

        const SCALE = (1 / 1_000_000) * orbitScale;

        // Unify the line into a single, smooth orbit tracking exactly 1 period
        const orbitalPeriodMs = (config.orbitalPeriod || 30) * 24 * 60 * 60 * 1000;
        const startTime = new Date(moonTrajectory[0].timestamp).getTime();
        
        const rawPoints: THREE.Vector3[] = [];
        for (const t of moonTrajectory) {
          const tMs = new Date(t.timestamp).getTime();
          rawPoints.push(new THREE.Vector3(t.position.x * SCALE, t.position.y * SCALE, t.position.z * SCALE));
          // Break once we have covered a full orbital period or end of buffer
          if (tMs - startTime >= orbitalPeriodMs) break;
        }

        // Use CatmullRomCurve3 to smooth out sparse JPL Horizons steps into a perfect ring.
        // Only set 'closed: true' if the data actually covers nearly the full period to avoid shortcuts.
        const totalTimeMs =
          new Date(moonTrajectory[moonTrajectory.length - 1].timestamp).getTime() -
          startTime;
        const coverageRatio = orbitalPeriodMs > 0 ? totalTimeMs / orbitalPeriodMs : 0;
        const isClosed = coverageRatio >= 0.95;

        let finalPoints = rawPoints;
        if (rawPoints.length >= 3) {
          const curve = new THREE.CatmullRomCurve3(rawPoints, isClosed);
          finalPoints = curve.getPoints(128); // 128 segments for smoothness
        }

        return (
          <OrbitLine
            key={`orbit-${moonId}`}
            points={finalPoints}
            opacity={0.12}
            color="#88aaff"
            viewMode={viewMode}
          />
        );
      })}

      {/* 2. Moon Meshes (Consumes master pool) */}
      {moonIds.map((moonId) => {
        const moonTrajectory = masterTrajectory[moonId];
        if (!moonTrajectory || moonTrajectory.length === 0) return null;

        const moon = moonTrajectory[0]; // Reference for initial stats
        const config = getPlanetConfig(moonId);
        if (!config) return null;

        const moonPos = scalePositionFromKm(
          moon.position.x,
          moon.position.y,
          moon.position.z
        );

        const orbitScale = getMoonOrbitScale(
          parentId,
          parentClass,
          config.meanDistanceAU * AU_TO_KM,
          viewMode
        );

        const scaledMoonPos: [number, number, number] = [
          moonPos[0] * orbitScale,
          moonPos[1] * orbitScale,
          moonPos[2] * orbitScale,
        ];

        const moonRadius = getRadius(moonId, 'MOON', viewMode);
        const distanceToParentKm = Math.sqrt(
          moon.position.x ** 2 + moon.position.y ** 2 + moon.position.z ** 2
        );

        const baseWorldParentPos = worldParentPosition || parentPosition;
        const realisticWorldPos = {
          x: baseWorldParentPos[0] + moonPos[0],
          y: baseWorldParentPos[1] + moonPos[1],
          z: baseWorldParentPos[2] + moonPos[2],
        };

        const moonPayload = {
          bodyId: moonId,
          name: config.name,
          englishName: config.englishName,
          position: moon.position,
          velocity: moonTrajectory[0].velocity, // Using first point for velocity ref
          trajectory: moonTrajectory,
          radius: moonRadius,
          distanceFromSun: 0,
          parentId,
          parentName: parentConfig?.englishName ?? parentId,
          distanceToParentKm,
        };

        const handleMoonClick = () => setSelectedPlanet(moonPayload);

        const handleMoonDoubleClick = () => {
          setSelectedPlanet(moonPayload);
          setViewMode('realistic');
          const realisticRadius = getRadius(moonId, 'MOON', 'realistic');
          setTravelTarget(realisticWorldPos, Math.max(realisticRadius * 50, 0.005));
        };

        return (
          <Suspense key={`moon-mesh-${moonId}`} fallback={null}>
            <MoonMesh
              bodyId={moonId}
              name={config.englishName}
              initialPosition={scaledMoonPos}
              trajectory={moonTrajectory}
              orbitScale={orbitScale}
              radius={moonRadius}
              textureUrl={getTexturePath(moonId, textureTier)}
              rotationSpeed={config.rotationSpeed}
              fallbackColor={config.fallbackColor}
              viewMode={viewMode}
              onClick={handleMoonClick}
              onDoubleClick={handleMoonDoubleClick}
            />
          </Suspense>
        );
      })}
    </group>
  );
}
