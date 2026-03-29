'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { useFrame, ThreeEvent, useThree } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import { KTX2Loader } from 'three-stdlib';
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
  type BodyClass,
  type ViewMode,
  KM_TO_UNIT,
} from '@/lib/scales';
import { useSolarStore } from '@/store/solarStore';
import { useShallow } from 'zustand/react/shallow';
import { buildTrajectorySegment, sampleTrajectoryAtTime } from '@/lib/trajectoryEngine';
import { SPHERE_MID, HITBOX_SPHERE } from '@/lib/geometryPool';

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
  orbitScale: number;
  radius: number;
  textureUrl: string;
  rotationSpeed: number;
  fallbackColor: string;
  viewMode: ViewMode;
  meanDistanceAU: number;
  orbitalPeriod: number;
  orbitalInclination?: number;
  longAscNode?: number;
  onClick: () => void;
  onDoubleClick: () => void;
}

// ---------------------------------------------------------------------------
// Shared Resources & Loaders
// ---------------------------------------------------------------------------

const AU_TO_KM = 149_597_870.7;

function resolveTextureTier(tier: string): TextureTier {
  if (tier === 'low' || tier === 'high') return tier;
  return 'mid';
}

// Global singleton to prevent recreating workers and to avoid React Suspense
let globalKtx2Loader: KTX2Loader | null = null;
function getKtx2Loader(gl: THREE.WebGLRenderer) {
  if (!globalKtx2Loader) {
    globalKtx2Loader = new KTX2Loader();
    globalKtx2Loader.setTranscoderPath('/basis/');
    globalKtx2Loader.detectSupport(gl);
  }
  return globalKtx2Loader;
}

/**
 * Helper to calculate a 3D point on a Keplerian orbit using Euler Angles.
 */
function getCircularOrbitPoint(
  simTime: number,
  orbitalPeriod: number,
  meanDistanceAU: number,
  orbitScale: number,
  inclinationDeg: number = 0,
  longAscNodeDeg: number = 0,
  target: THREE.Vector3
): THREE.Vector3 {
  const periodMs = (orbitalPeriod || 30) * 24 * 60 * 60 * 1000;
  const distUnits = (meanDistanceAU * AU_TO_KM) * KM_TO_UNIT * orbitScale;
  
  // 1. Position in the base orbital plane (Flat Ecliptic XZ)
  const angle = (simTime / periodMs) * Math.PI * 2;
  target.set(distUnits * Math.cos(angle), 0, distUnits * Math.sin(angle));
  
  // 2. Pure Astronomical Orientation (Euler Angles)
  // X axis tilts the orbit (Inclination)
  // Y axis rotates to align with Galactic Compass (Ascending Node)
  const i = THREE.MathUtils.degToRad(inclinationDeg);
  const omega = THREE.MathUtils.degToRad(longAscNodeDeg);
  
  // YXZ Order: Apply Inclination (X) then rotation around the vertical (Y)
  const euler = new THREE.Euler(i, omega, 0, 'YXZ');
  target.applyEuler(euler);

  return target;
}

// ---------------------------------------------------------------------------
// MoonMesh
// ---------------------------------------------------------------------------

function MoonMesh({
  bodyId,
  name,
  orbitScale,
  radius,
  textureUrl,
  rotationSpeed,
  fallbackColor,
  viewMode,
  meanDistanceAU,
  orbitalPeriod,
  orbitalInclination,
  longAscNode,
  onClick,
  onDoubleClick,
}: MoonMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const gl = useThree((state) => state.gl);
  const isInitializedRef = useRef(false);
  const [isHovered, setIsHovered] = useState(false);
  const tempVec = useRef(new THREE.Vector3());

  // Non-suspending texture state
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  // Subscribe only to this specific moon's trajectory
  const trajectory = useSolarStore(useShallow(state => state.masterTrajectory[bodyId] || []));
  const masterSegments = useSolarStore(useShallow(state => state.masterTrajectorySegments[bodyId] || []));
  
  const fallbackSegments = useMemo(() => {
    if (!trajectory || trajectory.length === 0) return [];
    const segment = buildTrajectorySegment(trajectory);
    return segment ? [segment] : [];
  }, [trajectory]);

  // Load texture asynchronously without triggering <Suspense>
  useEffect(() => {
    const loader = getKtx2Loader(gl);
    loader.loadAsync(textureUrl)
      .then(setTexture)
      .catch((err) => console.error(`Failed to load moon texture: ${textureUrl}`, err));
  }, [textureUrl, gl]);

  // Dispose of material on unmount
  useEffect(() => {
    const currentMesh = meshRef.current;
    return () => {
      if (currentMesh?.material) {
        (currentMesh.material as THREE.Material).dispose();
      }
    };
  }, []);

  useFrame((_, delta) => {
    const solarState = useSolarStore.getState();
    const simTime = solarState.currentTime.getTime();
    const isPlaying = solarState.isPlaying;
    const timeMultiplier = solarState.timeMultiplier;

    const segments = masterSegments.length > 0 ? masterSegments : fallbackSegments;

    if (groupRef.current) {
      // 1. Position calculation (Real data OR Math Fallback)
      if (segments.length > 0) {
        // We have real NASA data
        const SCALE = (1 / 1_000_000) * orbitScale;
        const sampled = sampleTrajectoryAtTime(segments, simTime);
        if (sampled) {
          const { x, y, z } = sampled.position;
          const targetPos = tempVec.current.set(x * SCALE, y * SCALE, z * SCALE);
          
          if (!isInitializedRef.current) {
            groupRef.current.position.copy(targetPos);
            isInitializedRef.current = true;
          } else {
            const lerpFactor = 1 - Math.exp(-10 * delta);
            groupRef.current.position.lerp(targetPos, lerpFactor); 
          }
        }
      } else {
        // FALLBACK: Simulate Ecliptic-aligned circular orbit
        const targetPos = getCircularOrbitPoint(
          simTime,
          orbitalPeriod,
          meanDistanceAU,
          orbitScale,
          orbitalInclination,
          longAscNode,
          tempVec.current
        );

        if (!isInitializedRef.current) {
          groupRef.current.position.copy(targetPos);
          isInitializedRef.current = true;
        } else {
          const lerpFactor = 1 - Math.exp(-10 * delta);
          groupRef.current.position.lerp(targetPos, lerpFactor); 
        }
      }
    }

    // 2. Rotation (Time-scaled)
    if (meshRef.current) {
      meshRef.current.rotation.y += rotationSpeed * 60 * delta * (isPlaying ? timeMultiplier : 1);
    }
  });

  const fontSize = viewMode === 'didactic' ? radius * 0.8 : radius * 12;
  const hitboxRadius = viewMode === 'realistic' ? Math.max(radius * 20, 0.05) : radius * 1.5;
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
      <mesh {...events} geometry={HITBOX_SPHERE} scale={hitboxRadius} renderOrder={-1} dispose={null}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh ref={meshRef} {...events} geometry={SPHERE_MID} scale={radius} dispose={null}>
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
      {/* 1. Orbit Lines */}
      {moonIds.map((moonId) => {
        return <MoonOrbitLine 
          key={`orbit-${moonId}`}
          moonId={moonId}
          parentId={parentId}
          parentClass={parentClass}
          viewMode={viewMode}
        />;
      })}

      {/* 2. Moon Meshes */}
      {moonIds.map((moonId) => {
        const config = getPlanetConfig(moonId);
        if (!config) return null;

        // HEURÍSTICA: Se a lua tem inclinação > 2 (ex: a nossa Lua da Terra com 5º), usamos a dela.
        // Se for perto de zero (ex: Io, Europa), ela orbita o equador, logo herda a inclinação do Planeta.
        const effInclination = config.orbitalInclination && config.orbitalInclination > 2 
          ? config.orbitalInclination 
          : (parentConfig?.axialTilt || 0);
          
        const effAscNode = config.longAscNode && config.longAscNode > 0 
          ? config.longAscNode 
          : (parentConfig?.longAscNode || 0);

        const orbitScale = getMoonOrbitScale(
          parentId,
          parentClass,
          config.meanDistanceAU * AU_TO_KM,
          viewMode
        );

        const moonRadius = getRadius(moonId, 'MOON', viewMode);
        
        // Setup payload for UI selection (uses fallback values if real trajectory isn't ready)
        const moonTrajectory = useSolarStore.getState().masterTrajectory[moonId];
        
        // "Ghost Click" Protection: Calculate physics-aligned coordinates for zoom
        const simTime = useSolarStore.getState().currentTime.getTime();
        const fallbackTarget = new THREE.Vector3();
        getCircularOrbitPoint(
          simTime,
          config.orbitalPeriod,
          config.meanDistanceAU,
          orbitScale,
          effInclination,
          effAscNode,
          fallbackTarget
        );
        
        const fallbackPos = { 
          x: fallbackTarget.x / KM_TO_UNIT / orbitScale, // De-scale back to true KM
          y: fallbackTarget.y / KM_TO_UNIT / orbitScale, 
          z: fallbackTarget.z / KM_TO_UNIT / orbitScale 
        };

        const currentPos = moonTrajectory && moonTrajectory.length > 0 
          ? moonTrajectory[0].position 
          : fallbackPos;

        const baseWorldParentPos = worldParentPosition || parentPosition;
        const realisticWorldPos = {
          x: baseWorldParentPos[0] + (currentPos.x * KM_TO_UNIT),
          y: baseWorldParentPos[1] + (currentPos.y * KM_TO_UNIT),
          z: baseWorldParentPos[2] + (currentPos.z * KM_TO_UNIT),
        };

        const distanceToParentKm = Math.sqrt(currentPos.x ** 2 + currentPos.y ** 2 + currentPos.z ** 2);

        const moonPayload = {
          bodyId: moonId,
          name: config.name,
          englishName: config.englishName,
          position: currentPos,
          velocity: moonTrajectory && moonTrajectory.length > 0 ? moonTrajectory[0].velocity : { x: 0, y: 0, z: 0 }, 
          trajectory: moonTrajectory || [],
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
          <MoonMesh
            key={`moon-mesh-${moonId}`}
            bodyId={moonId}
            name={config.englishName}
            orbitScale={orbitScale}
            radius={moonRadius}
            textureUrl={getTexturePath(moonId, textureTier)}
            rotationSpeed={config.rotationSpeed || 0.005}
            fallbackColor={config.fallbackColor || '#888888'}
            viewMode={viewMode}
            meanDistanceAU={config.meanDistanceAU || 0.002}
            orbitalPeriod={config.orbitalPeriod || 30}
            orbitalInclination={effInclination}
            longAscNode={effAscNode}
            onClick={handleMoonClick}
            onDoubleClick={handleMoonDoubleClick}
          />
        );
      })}
    </group>
  );
}

function MoonOrbitLine({ moonId, parentId, parentClass, viewMode }: { moonId: string, parentId: string, parentClass: BodyClass, viewMode: ViewMode }) {
  const moonTrajectory = useSolarStore(useShallow(s => s.masterTrajectory[moonId]));
  const config = getPlanetConfig(moonId);
  const parentConfig = getPlanetConfig(parentId);

  if (!config) return null;

  const orbitScale = getMoonOrbitScale(
    parentId,
    parentClass,
    config.meanDistanceAU * AU_TO_KM,
    viewMode
  );

  // INHERITANCE HEURISTIC
  const effInclination = config.orbitalInclination && config.orbitalInclination > 2 
    ? config.orbitalInclination 
    : (parentConfig?.axialTilt || 0);
    
  const effAscNode = config.longAscNode && config.longAscNode > 0 
    ? config.longAscNode 
    : (parentConfig?.longAscNode || 0);

  // Memoize fallback points to prevent CPU churn
  const circlePoints = useMemo(() => {
    const points: THREE.Vector3[] = [];
    const segments = 128;
    const tempTarget = new THREE.Vector3();
    const periodMs = (config.orbitalPeriod || 30) * 24 * 60 * 60 * 1000;
    
    for (let i = 0; i <= segments; i++) {
      const simTimeSample = (i / segments) * periodMs;
      getCircularOrbitPoint(
        simTimeSample,
        config.orbitalPeriod,
        config.meanDistanceAU,
        orbitScale,
        effInclination,
        effAscNode,
        tempTarget
      );
      points.push(tempTarget.clone());
    }
    return points;
  }, [config, orbitScale, effInclination, effAscNode]);

  // If no NASA data yet, render the inclined fallback ring
  if (!moonTrajectory || moonTrajectory.length < 2) {
    return (
      <TrailLine
        points={circlePoints}
        color="#88aaff"
        fadeMode="ring"
        opacity={0.4}
      />
    );
  }

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
      opacity={0.4}
    />
  );
}
