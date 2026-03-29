'use client';

import { useMemo, useRef, useState, Suspense, useEffect } from 'react';
import { useLoader, useFrame, ThreeEvent } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import { TextureLoader } from 'three';
import * as THREE from 'three';
import TrailLine from './TrailLine';

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
  viewMode: ViewMode;
  tier: string;
}

interface MoonMeshProps {
  bodyId: string;
  name: string;
  initialPosition: [number, number, number];
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
// Shared Resources (Static)
// ---------------------------------------------------------------------------

const AU_TO_KM = 149_597_870.7;
const SHARED_GEOMETRY = new THREE.SphereGeometry(1, 24, 24);
const HITBOX_GEOMETRY = new THREE.SphereGeometry(1, 8, 8);

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
  const isInitializedRef = useRef(false);
  const [isHovered, setIsHovered] = useState(false);
  const tempVec = useRef(new THREE.Vector3());

  // Subscribe only to this specific moon's trajectory
  const trajectory = useSolarStore(useShallow(state => state.masterTrajectory[bodyId] || []));
  
  const fallbackSegments = useMemo(() => {
    if (!trajectory || trajectory.length === 0) return [];
    const segment = buildTrajectorySegment(trajectory);
    return segment ? [segment] : [];
  }, [trajectory]);

  const texture = useLoader(TextureLoader, textureUrl, (loader) => {
    loader.setCrossOrigin('anonymous');
  });

  // Dispose of material on unmount (geometry is shared)
  useEffect(() => {
    return () => {
      if (meshRef.current?.material) {
        (meshRef.current.material as THREE.Material).dispose();
      }
    };
  }, []);

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
        const targetPos = tempVec.current.set(x * SCALE, y * SCALE, z * SCALE);
        
        if (!isInitializedRef.current) {
          groupRef.current.position.copy(targetPos);
          isInitializedRef.current = true;
        } else {
          // Use frame-rate independent LERP (approx 0.15 at 60fps)
          const lerpFactor = 1 - Math.exp(-10 * delta);
          groupRef.current.position.lerp(targetPos, lerpFactor); 
        }
      }
    } else if (groupRef.current && !isInitializedRef.current) {
      groupRef.current.position.set(...initialPosition);
      isInitializedRef.current = true;
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
    <group name={name} ref={groupRef}>
      <mesh {...events} geometry={HITBOX_GEOMETRY} scale={hitboxRadius} renderOrder={-1}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh ref={meshRef} {...events} geometry={SHARED_GEOMETRY} scale={radius}>
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
  viewMode,
  tier,
}: MoonSystemProps) {
  const moonIds = PLANET_MOONS[parentId] ?? [];
  const hasMoons = moonIds.length > 0;

  const { setSelectedPlanet, setViewMode, setTravelTarget } = useSolarStore(
    useShallow((s) => ({
      setSelectedPlanet: s.setSelectedPlanet,
      setViewMode: s.setViewMode,
      setTravelTarget: s.setTravelTarget,
    }))
  );

  const parentConfig = getPlanetConfig(parentId);

  if (!hasMoons) return null;

  const textureTier = resolveTextureTier(tier);

  return (
    <group position={parentPosition}>
      {/* 1. Orbit Lines (Consumes trajectories from master pool) */}
      {moonIds.map((moonId) => {
        // Use individual hooks inside the map for selective updates
        return <MoonOrbitLine 
          key={`orbit-${moonId}`}
          moonId={moonId}
          parentId={parentId}
          parentClass={parentClass}
          viewMode={viewMode}
        />;
      })}

      {/* 2. Moon Meshes (Consumes master pool) */}
      {moonIds.map((moonId) => {
        const config = getPlanetConfig(moonId);
        if (!config) return null;

        // Note: Moon trajectory used here only for initial position, MoonMesh subscribes internally
        const moonTrajectory = useSolarStore.getState().masterTrajectory[moonId];
        if (!moonTrajectory || moonTrajectory.length === 0) return null;

        const moon = moonTrajectory[0]; 

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
          velocity: moonTrajectory[0].velocity, 
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

function MoonOrbitLine({ moonId, parentId, parentClass, viewMode }: { moonId: string, parentId: string, parentClass: BodyClass, viewMode: ViewMode }) {
  const moonTrajectory = useSolarStore(useShallow(s => s.masterTrajectory[moonId]));
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

  // 1. COORDINATE SHIELD (Prevents iOS "Spider Web" artifacts)
  const safeRawPoints = rawPoints.filter((p, i, arr) => {
    // Remove invalid math results that crash the GPU buffers on WebKit
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false;
    
    // Remove duplicate points that cause division-by-zero during 
    // curve interpolation (critical for iOS stability)
    if (i > 0 && p.distanceToSquared(arr[i - 1]) < 0.000001) return false;
    
    return true;
  });

  // Use CatmullRomCurve3 to smooth out sparse JPL Horizons steps into a perfect ring.
  const totalTimeMs =
    new Date(moonTrajectory[moonTrajectory.length - 1].timestamp).getTime() -
    startTime;
  const coverageRatio = orbitalPeriodMs > 0 ? totalTimeMs / orbitalPeriodMs : 0;
  const isClosed = coverageRatio >= 0.95;

  let finalPoints = safeRawPoints;
  if (safeRawPoints.length >= 3) {
    const curve = new THREE.CatmullRomCurve3(safeRawPoints, isClosed);
    finalPoints = curve.getPoints(128); // 128 segments for smoothness
  }

  return (
    <TrailLine
      points={finalPoints}
      color="#88aaff"
      fadeMode="ring"
      opacity={0.6}
    />
  );
}
