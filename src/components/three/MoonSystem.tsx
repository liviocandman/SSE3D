/**
 * Coordinate-stabilized MoonSystem component.
 */

import { useRef, useState, useEffect, Suspense, useMemo } from 'react';
import { useFrame, useThree, useLoader } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { SingletonKTX2Loader, getSharedKTX2Loader } from '@/lib/SingletonKTX2Loader';
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
import { sampleTrajectoryAtTime } from '@/lib/trajectoryEngine';
import { createTemporalLookupCache } from '@/lib/temporalLookup';
import { SPHERE_MID, HITBOX_SPHERE } from '@/lib/geometryPool';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MoonSystemProps {
  parentId: string;
  parentClass: BodyClass;
  parentPosition: [number, number, number]; // Render units (local to planet group)
  worldParentPositionKm: { x: number; y: number; z: number }; // Absolute KM of parent
  viewMode: ViewMode;
  tier: string;
}

interface MoonMeshProps {
  bodyId: string;
  parentId: string;
  parentName: string;
  parentClass: BodyClass;
  viewMode: ViewMode;
  tier: string;
  worldParentPositionKm: { x: number; y: number; z: number };
}

// ---------------------------------------------------------------------------
// Shared Resources & Loaders
// ---------------------------------------------------------------------------

const AU_TO_KM = 149_597_870.7;
const DAY_MS = 24 * 60 * 60 * 1000;
const FALLBACK_SPAN_DAYS = 30;
const MIN_CLOSED_ORBIT_COVERAGE = 0.9;
const MIN_FAST_MOON_ORBIT_POINTS = 8;
const MIN_SMOOTHING_POINTS = 6;
const MIN_CURVE_SAMPLES = 128;
const MAX_CURVE_SAMPLES = 256;
const MOON_CLOSEUP_TRAVEL_RADIUS_MULTIPLIER = 2;

// Global singleton to prevent recreating workers and to avoid React Suspense
// (Removed local globalKtx2Loader and getKtx2Loader, now using getSharedKTX2Loader)

function parseUtcTimestampMs(timestamp: string): number {
  if (!timestamp) return Number.NaN;
  const utcString = timestamp.includes('Z') ? timestamp : `${timestamp}Z`;
  return new Date(utcString).getTime();
}

function getTrajectorySpanDays(
  trajectory: Array<{ timestamp: string }>,
): number {
  if (trajectory.length < 2) return 0;

  const startMs = parseUtcTimestampMs(trajectory[0].timestamp);
  const endMs = parseUtcTimestampMs(trajectory[trajectory.length - 1].timestamp);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }

  return (endMs - startMs) / DAY_MS;
}

function estimateMeanRadius(points: THREE.Vector3[]): number {
  if (points.length === 0) return 0;

  const center = new THREE.Vector3();
  for (const point of points) {
    center.add(point);
  }
  center.divideScalar(points.length);

  let radiusSum = 0;
  for (const point of points) {
    radiusSum += point.distanceTo(center);
  }
  return radiusSum / points.length;
}

function resolveTextureTier(tier: string): TextureTier {
  if (tier === 'low' || tier === 'high') return tier;
  return 'mid';
}

// ---------------------------------------------------------------------------
// MoonMesh
// ---------------------------------------------------------------------------

function MoonMesh({
  bodyId,
  parentId,
  parentName,
  parentClass,
  viewMode,
  tier,
  worldParentPositionKm
}: MoonMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const gl = useThree((state) => state.gl);
  const isInitializedRef = useRef(false);
  const lookupCacheRef = useRef(createTemporalLookupCache());
  const parentLookupCacheRef = useRef(createTemporalLookupCache());
  const [isHovered, setIsHovered] = useState(false);
  const tempVec = useRef(new THREE.Vector3());

  const { setSelectedPlanet, setViewMode, setTravelTarget } = useSolarStore(
    useShallow((s) => ({
      setSelectedPlanet: s.setSelectedPlanet,
      setViewMode: s.setViewMode,
      setTravelTarget: s.setTravelTarget,
    }))
  );

  const config = useMemo(() => getPlanetConfig(bodyId), [bodyId]);

  // Reactive subscription: This component only re-renders if this specific moon's data changes.
  const moonTrajectory = useSolarStore(
    useShallow((s) => s.masterTrajectory[bodyId] || [])
  );
  const masterSegments = useSolarStore(
    useShallow((s) => s.masterTrajectorySegments[bodyId] || [])
  );

  // Pre-calculate properties for hooks safely
  const radius = getRadius(bodyId, 'MOON', viewMode);
  const textureTier = resolveTextureTier(tier);
  const textureUrl = config ? getTexturePath(bodyId, textureTier) : '';

  const orbitScale = config
    ? getMoonOrbitScale(
      parentId,
      parentClass,
      config.meanDistanceAU * AU_TO_KM,
      viewMode
    )
    : 1;

  const texture = useLoader(SingletonKTX2Loader as unknown as typeof THREE.Loader, textureUrl || '/textures/generic_moon_mid.ktx2', () => {
    getSharedKTX2Loader(gl);
  }) as THREE.Texture;

  // Correct color space for SRGB textures loaded via KTX2
  useEffect(() => {
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
    }
  }, [texture]);

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
    if (!config) return;
    const solarState = useSolarStore.getState();
    const simTime = solarState.currentTime.getTime();
    const isPlaying = solarState.isPlaying;
    const timeMultiplier = solarState.timeMultiplier;

    if (groupRef.current && masterSegments.length > 0) {
      const SCALE = KM_TO_UNIT * orbitScale;
      const sampled = sampleTrajectoryAtTime(masterSegments, simTime, lookupCacheRef.current);

      if (sampled) {
        // Moon trajectories from the backend are already parent-relative KM.
        // Since MoonSystem is a child of the parent CelestialBody, 
        // we just need to scale them to render units.
        const { x, y, z } = sampled.position;
        const targetPos = tempVec.current.set(x * SCALE, y * SCALE, z * SCALE);

        if (!isInitializedRef.current) {
          groupRef.current.position.copy(targetPos);
          isInitializedRef.current = true;
        } else {
          groupRef.current.position.lerp(targetPos, 1 - Math.exp(-10 * delta));
        }
      }
    }

    if (meshRef.current) {
      const rotationSpeed = config.rotationSpeed || 0.005;
      meshRef.current.rotation.y += rotationSpeed * 60 * delta * (isPlaying ? timeMultiplier : 1);
    }
  });

  if (!config) return null;

  const name = config.englishName;

  const resolveCurrentMoonPosition = () => {
    const simTimeMs = useSolarStore.getState().currentTime.getTime();
    const sampled = masterSegments.length > 0
      ? sampleTrajectoryAtTime(masterSegments, simTimeMs, lookupCacheRef.current)
      : null;

    return sampled?.position ?? moonTrajectory[0]?.position ?? { x: 0, y: 0, z: 0 };
  };

  const resolveParentAbsolutePositionKm = () => {
    const parentFromProps = worldParentPositionKm;
    const parentMagnitudeKm = Math.sqrt(
      parentFromProps.x ** 2 +
      parentFromProps.y ** 2 +
      parentFromProps.z ** 2
    );

    // Defensive fallback: if parent absolute position is unresolved, sample it from master trajectory.
    if (parentId !== '10' && parentMagnitudeKm < 1000) {
      const state = useSolarStore.getState();
      const parentSegments = state.masterTrajectorySegments[parentId] ?? [];
      if (parentSegments.length > 0) {
        const sampledParent = sampleTrajectoryAtTime(
          parentSegments,
          state.currentTime.getTime(),
          parentLookupCacheRef.current
        );
        if (sampledParent?.position) {
          return sampledParent.position;
        }
      }
    }

    return parentFromProps;
  };

  const handleClick = () => {
    const currentPos = resolveCurrentMoonPosition();
    const parentAbsolutePos = resolveParentAbsolutePositionKm();
    const absolutePos = {
      x: parentAbsolutePos.x + currentPos.x,
      y: parentAbsolutePos.y + currentPos.y,
      z: parentAbsolutePos.z + currentPos.z,
    };
    const distanceToParentKm = Math.sqrt(currentPos.x ** 2 + currentPos.y ** 2 + currentPos.z ** 2);

    setSelectedPlanet({
      bodyId,
      name: config.name,
      englishName: config.englishName,
      position: absolutePos,
      velocity: moonTrajectory[0]?.velocity ?? { x: 0, y: 0, z: 0 },
      trajectory: moonTrajectory,
      radius: radius,
      distanceFromSun: 0,
      parentId,
      parentName,
      distanceToParentKm,
    });
  };

  const handleDoubleClick = () => {
    const currentPos = resolveCurrentMoonPosition();
    const parentAbsolutePos = resolveParentAbsolutePositionKm();
    const absolutePos = {
      x: parentAbsolutePos.x + currentPos.x,
      y: parentAbsolutePos.y + currentPos.y,
      z: parentAbsolutePos.z + currentPos.z,
    };

    handleClick(); // Set selected state
    setViewMode('realistic');
    const realisticRadius = getRadius(bodyId, 'MOON', 'realistic');
    setTravelTarget(absolutePos, realisticRadius * MOON_CLOSEUP_TRAVEL_RADIUS_MULTIPLIER);
  };

  const events = {
    onClick: handleClick,
    onDoubleClick: handleDoubleClick,
    onPointerEnter: () => {
      setIsHovered(true);
      document.body.style.cursor = 'pointer';
    },
    onPointerLeave: () => {
      setIsHovered(false);
      document.body.style.cursor = 'auto';
    },
  };

  const isDataLoading = masterSegments.length === 0;
  const currentRadius = isDataLoading ? 0 : radius;

  const fontSize = viewMode === 'didactic' ? radius * 0.8 : radius * 12;
  const hitboxRadius = viewMode === 'realistic' ? Math.max(radius * 40, 0.1) : radius * 1.5;
  const labelY = isHovered ? radius * 1.8 : -radius * 1.8;
  const labelColor = isHovered ? '#ffffff' : '#8ab4d8';
  const labelAnchorY = isHovered ? 'bottom' : 'top';

  return (
    <group name={bodyId} ref={groupRef}>
      <mesh {...events} geometry={HITBOX_SPHERE} scale={isDataLoading ? 0 : hitboxRadius} renderOrder={-1} dispose={null}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh ref={meshRef} {...events} geometry={SPHERE_MID} scale={currentRadius} dispose={null}>
        <meshStandardMaterial
          map={texture || null}
          color="#ffffff"
          emissive={texture ? 0x000000 : (config.fallbackColor || '#888888')}
          emissiveIntensity={texture ? 0 : 0.5}
          transparent={isDataLoading}
          opacity={isDataLoading ? 0 : 1}
        />
      </mesh>

      {isHovered && !isDataLoading && (
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

      {!isDataLoading && (
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
      )}
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
  worldParentPositionKm,
  viewMode,
  tier,
}: MoonSystemProps) {
  const moonIds = PLANET_MOONS[parentId] ?? [];
  const hasMoons = moonIds.length > 0;

  const parentConfig = getPlanetConfig(parentId);

  if (!hasMoons) return null;

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
        return (
          <Suspense key={`moon-suspense-${moonId}`} fallback={null}>
            <MoonMesh
              bodyId={moonId}
              parentId={parentId}
              parentName={parentConfig?.englishName ?? parentId}
              parentClass={parentClass}
              worldParentPositionKm={worldParentPositionKm}
              viewMode={viewMode}
              tier={tier}
            />
          </Suspense>
        );
      })}
    </group>
  );
}

function MoonOrbitLine({ moonId, parentId, parentClass, viewMode }: { moonId: string, parentId: string, parentClass: BodyClass, viewMode: ViewMode }) {
  const moonTrajectory = useSolarStore(useShallow((s) => s.masterTrajectory[moonId]));
  const config = getPlanetConfig(moonId);

  // No trajectory data yet: skip rendering until data arrives.
  if (!config || !moonTrajectory || moonTrajectory.length < 2) return null;

  const orbitScale = getMoonOrbitScale(parentId, parentClass, config.meanDistanceAU * AU_TO_KM, viewMode);
  const SCALE = KM_TO_UNIT * orbitScale;

  // Compute orbit coverage from real timestamps instead of assuming a fixed 30-day window.
  const observedSpanDays = getTrajectorySpanDays(moonTrajectory);
  const orbitalPeriodDays = Math.max(config.orbitalPeriod || FALLBACK_SPAN_DAYS, 1e-6);
  const spanDays = observedSpanDays > 0 ? observedSpanDays : FALLBACK_SPAN_DAYS;
  const orbitsInSpan = spanDays / orbitalPeriodDays;

  let pointsToTake = moonTrajectory.length;
  let isClosed = false;

  if (orbitsInSpan >= MIN_CLOSED_ORBIT_COVERAGE) {
    // For full/near-full coverage, draw a closed loop.
    isClosed = true;

    // Keep approximately one revolution, but never below a minimum point budget.
    const desiredPointsPerOrbit = Math.ceil(moonTrajectory.length / Math.max(orbitsInSpan, 1));
    const minOrbitPoints = Math.min(moonTrajectory.length, MIN_FAST_MOON_ORBIT_POINTS);
    pointsToTake = Math.min(
      moonTrajectory.length,
      Math.max(desiredPointsPerOrbit, minOrbitPoints),
    );
  } else {
    // Slow moons with partial coverage remain open arcs.
    isClosed = false;
  }

  const rawPoints: THREE.Vector3[] = [];
  for (let i = 0; i < pointsToTake; i++) {
    const t = moonTrajectory[i];
    const p = new THREE.Vector3(t.position.x * SCALE, t.position.y * SCALE, t.position.z * SCALE);

    // Coordinate safety filter for GPU stability.
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    if (rawPoints.length > 0 && p.distanceToSquared(rawPoints[rawPoints.length - 1]) < 1e-10) continue;

    rawPoints.push(p);
  }

  // If closure gap is too large relative to orbit radius, keep it open to avoid "spider web" artifacts.
  if (isClosed && rawPoints.length >= 3) {
    const first = rawPoints[0];
    const last = rawPoints[rawPoints.length - 1];
    const closureGap = first.distanceTo(last);
    const meanRadius = estimateMeanRadius(rawPoints);
    if (meanRadius > 0 && closureGap > meanRadius * 0.75) {
      isClosed = false;
    }
  }

  // Smooth orbit lines when enough points exist.
  let finalPoints = rawPoints;
  if (rawPoints.length >= MIN_SMOOTHING_POINTS) {
    try {
      const curve = new THREE.CatmullRomCurve3(rawPoints, isClosed);
      const sampleCount = Math.min(
        MAX_CURVE_SAMPLES,
        Math.max(MIN_CURVE_SAMPLES, rawPoints.length * 24),
      );
      finalPoints = curve.getPoints(sampleCount);
    } catch {
      console.warn(`[MoonOrbitLine] Curve generation failed for ${moonId}, using raw points.`);
    }
  }

  // Ensure closed loops are explicitly closed when Catmull-Rom is not used.
  if (isClosed && finalPoints.length >= 2) {
    const first = finalPoints[0];
    const last = finalPoints[finalPoints.length - 1];
    if (first.distanceToSquared(last) > 1e-12) {
      finalPoints = [...finalPoints, first.clone()];
    }
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
