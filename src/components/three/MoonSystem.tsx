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
import { type TrajectorySegment } from '@/lib/trajectoryEngine';
import { createTemporalLookupCache } from '@/lib/temporalLookup';
import { SPHERE_MID, HITBOX_SPHERE } from '@/lib/geometryPool';
import { clockRuntime } from '@/lib/time/clockRuntime';
import type { EphemerisTrajectory } from '@/lib/types';
import { USE_BACKEND_ORBIT_READY } from '@/lib/types';
import { resolveMoonFrame } from '@/lib/simulation/frameResolvers';

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
const MOON_CLOSEUP_TRAVEL_RADIUS_MULTIPLIER = 2;
const EMPTY_TRAJECTORY: EphemerisTrajectory[] = [];
const EMPTY_SEGMENTS: TrajectorySegment[] = [];
const ORBIT_FETCH_MAX_RETRIES = 5;
const ORBIT_FETCH_BASE_DELAY_MS = 600;
const MAX_LIGHT_FALLBACK_POINTS = 240;

// Global singleton to prevent recreating workers and to avoid React Suspense
// (Removed local globalKtx2Loader and getKtx2Loader, now using getSharedKTX2Loader)

function resolveSegmentAroundTime(segments: TrajectorySegment[], simTimeMs: number): TrajectorySegment | null {
  if (segments.length === 0) return null;

  const containing = segments.find(
    (segment) => simTimeMs >= segment.startTimeMs && simTimeMs <= segment.endTimeMs
  );
  if (containing) return containing;

  let nearest = segments[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const distance =
      simTimeMs < segment.startTimeMs
        ? segment.startTimeMs - simTimeMs
        : simTimeMs > segment.endTimeMs
          ? simTimeMs - segment.endTimeMs
          : 0;
    if (distance < nearestDistance) {
      nearest = segment;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function resolveTextureTier(tier: string): TextureTier {
  if (tier === 'low' || tier === 'high') return tier;
  return 'mid';
}

function buildLightFallbackPoints(
  trajectory: EphemerisTrajectory[],
  scale: number,
): THREE.Vector3[] {
  if (trajectory.length < 2) return [];

  const step = Math.max(1, Math.ceil(trajectory.length / MAX_LIGHT_FALLBACK_POINTS));
  const points: THREE.Vector3[] = [];

  for (let i = 0; i < trajectory.length; i += step) {
    const pos = trajectory[i].position;
    const point = new THREE.Vector3(pos.x * scale, pos.y * scale, pos.z * scale);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
    if (points.length > 0 && point.distanceToSquared(points[points.length - 1]) < 1e-10) continue;
    points.push(point);
  }

  return points;
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
  const absPositionKmRef = useRef(new THREE.Vector3());
  const localPositionKmRef = useRef(new THREE.Vector3());

  const { setSelectedPlanet, setViewMode, setTravelTarget } = useSolarStore(
    useShallow((s) => ({
      setSelectedPlanet: s.setSelectedPlanet,
      setViewMode: s.setViewMode,
      setTravelTarget: s.setTravelTarget,
    }))
  );

  const config = useMemo(() => getPlanetConfig(bodyId), [bodyId]);

  // Reactive subscription: This component only re-renders if this specific moon's data changes.
  const selectedMoonTrajectory = useSolarStore(useShallow((s) => s.masterTrajectory[bodyId]));
  const selectedMasterSegments = useSolarStore(useShallow((s) => s.masterTrajectorySegments[bodyId]));
  const moonTrajectory = selectedMoonTrajectory ?? EMPTY_TRAJECTORY;
  const masterSegments = selectedMasterSegments ?? EMPTY_SEGMENTS;

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
    const simTime = clockRuntime.getTimeMs();
    const isPlaying = solarState.isPlaying;
    const timeMultiplier = solarState.timeMultiplier;

    // Resolve moon positions using simulation layer
    const status = resolveMoonFrame(
      bodyId,
      parentId,
      simTime,
      absPositionKmRef.current,
      localPositionKmRef.current,
      lookupCacheRef.current,
      parentLookupCacheRef.current
    );

    if (groupRef.current && status !== 'no-data') {
      const SCALE = KM_TO_UNIT * orbitScale;
      // Moon trajectories from the backend are parent-relative KM.
      // Simulation resolveMoonFrame provides localPositionKm in this parent-relative KM.
      const { x, y, z } = localPositionKmRef.current;
      const targetPos = tempVec.current.set(x * SCALE, y * SCALE, z * SCALE);

      if (!isInitializedRef.current) {
        groupRef.current.position.copy(targetPos);
        isInitializedRef.current = true;
      } else {
        groupRef.current.position.lerp(targetPos, 1 - Math.exp(-10 * delta));
      }
    }

    if (meshRef.current) {
      const rotationSpeed = config.rotationSpeed || 0.005;
      meshRef.current.rotation.y += rotationSpeed * 60 * delta * (isPlaying ? timeMultiplier : 1);
    }
  });

  if (!config) return null;

  const name = config.englishName;

  const handleClick = () => {
    const currentPos = localPositionKmRef.current;
    const absolutePosKm = absPositionKmRef.current;
    
    const absolutePos = {
      x: absolutePosKm.x,
      y: absolutePosKm.y,
      z: absolutePosKm.z,
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
    const absolutePosKm = absPositionKmRef.current;
    const absolutePos = {
      x: absolutePosKm.x,
      y: absolutePosKm.y,
      z: absolutePosKm.z,
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
  const appendFullOrbits = useSolarStore((state) => state.appendFullOrbits);
  const moonIds = PLANET_MOONS[parentId] ?? [];
  const hasMoons = moonIds.length > 0;

  const parentConfig = getPlanetConfig(parentId);
  const moonIdsKey = moonIds.join(',');

  useEffect(() => {
    if (!hasMoons) return;

    let cancelled = false;

    const delay = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });

    const getMissingMoonIds = (): string[] => {
      const currentMoonIds = PLANET_MOONS[parentId] ?? [];
      const { fullOrbits, orbitLines } = useSolarStore.getState();
      return currentMoonIds.filter((moonId) => {
        const orbit = fullOrbits[moonId];
        const orbitLine = orbitLines[moonId];
        const hasOrbitLine = !USE_BACKEND_ORBIT_READY || (orbitLine && orbitLine.points.length >= 2);
        if (USE_BACKEND_ORBIT_READY) {
          return !hasOrbitLine;
        }
        return !orbit || orbit.length < 2;
      });
    };

    const fetchFullMoonOrbits = async () => {
      for (let attempt = 0; attempt < ORBIT_FETCH_MAX_RETRIES && !cancelled; attempt += 1) {
        const missingMoonIds = getMissingMoonIds();
        if (missingMoonIds.length === 0) return;

        try {
          const response = await fetch(`/api/ephemeris?ids=${missingMoonIds.join(',')}&fullOrbit=true&orbitReady=true&orbitLineOnly=true`);
          if (response.ok) {
            const payload = await response.json();
            if (!cancelled && Array.isArray(payload?.data)) {
              appendFullOrbits(payload.data);
            }
          }
        } catch {
          // Retry path handles transient wake/network errors.
        }

        if (getMissingMoonIds().length === 0 || cancelled) return;
        if (attempt < ORBIT_FETCH_MAX_RETRIES - 1) {
          await delay(ORBIT_FETCH_BASE_DELAY_MS * (attempt + 1));
        }
      }
    };

    void fetchFullMoonOrbits();
    return () => {
      cancelled = true;
    };
  }, [appendFullOrbits, hasMoons, moonIdsKey, parentId]);

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
  const moonSegments = useSolarStore(useShallow((s) => s.masterTrajectorySegments[moonId]));
  const fullOrbit = useSolarStore((state) => state.fullOrbits[moonId]);
  const orbitLine = useSolarStore((state) => state.orbitLines[moonId]);
  const config = getPlanetConfig(moonId);

  // No trajectory data yet: skip rendering until data arrives.
  if (!config) return null;

  const orbitScale = getMoonOrbitScale(parentId, parentClass, config.meanDistanceAU * AU_TO_KM, viewMode);
  const SCALE = KM_TO_UNIT * orbitScale;

  // Priority 1: backend-authoritative orbit line.
  if (USE_BACKEND_ORBIT_READY && orbitLine && orbitLine.points.length >= 2) {
    const finalPoints = orbitLine.points.map(p => new THREE.Vector3(p.x * SCALE, p.y * SCALE, p.z * SCALE));
    
    // Explicitly close the loop if backend says so
    if (orbitLine.isClosed && finalPoints.length >= 2) {
      const first = finalPoints[0];
      const last = finalPoints[finalPoints.length - 1];
      if (first.distanceToSquared(last) > 1e-12) {
        finalPoints.push(first.clone());
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

  // Priority 2: lightweight raw/sanitized fallback.
  const simTimeMs = clockRuntime.getTimeMs();
  const stableSegments = moonSegments ?? EMPTY_SEGMENTS;
  const activeSegment = resolveSegmentAroundTime(stableSegments, simTimeMs);
  const fallbackTrajectory = (fullOrbit && fullOrbit.length >= 2)
    ? fullOrbit
    : (activeSegment?.points && activeSegment.points.length >= 2)
      ? activeSegment.points
      : moonTrajectory ?? EMPTY_TRAJECTORY;

  const fallbackPoints = buildLightFallbackPoints(fallbackTrajectory, SCALE);
  if (fallbackPoints.length < 2) return null;

  return (
    <TrailLine
      points={fallbackPoints}
      color="#88aaff"
      fadeMode="ring"
      opacity={0.28}
    />
  );
}
