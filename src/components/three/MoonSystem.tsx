'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  AU_TO_UNIT,
  getMoonOrbitScale,
  getRadius,
  scalePositionFromKm,
  type BodyClass,
  type ViewMode,
} from '@/lib/scales';
import type { EphemerisData, EphemerisResponse } from '@/lib/types';
import { useSolarStore } from '@/store/solarStore';
import { useShallow } from 'zustand/react/shallow';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MoonSystemProps {
  parentId: string;
  parentClass: BodyClass;
  parentPosition: [number, number, number];
  date: string;
  viewMode: ViewMode;
  tier: string;
}

interface MoonMeshProps {
  name: string;
  position: [number, number, number];
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

/**
 * Individual moon mesh.
 * - meshLambertMaterial → no emissive, no Bloom blowout.
 * - Hover: label slides above mesh (matches CelestialBody pattern).
 * - Click  → select moon info card.
 * - DblClick → travel to moon (realistic mode).
 */
function MoonMesh({
  name,
  position,
  radius,
  textureUrl,
  rotationSpeed,
  fallbackColor,
  viewMode,
  onClick,
  onDoubleClick,
}: MoonMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [isHovered, setIsHovered] = useState(false);

  const texture = useLoader(TextureLoader, textureUrl, (loader) => {
    loader.setCrossOrigin('anonymous');
  });

  useFrame(() => {
    if (meshRef.current) meshRef.current.rotation.y += rotationSpeed;
  });

  const fontSize = viewMode === 'didactic' ? radius * 0.8 : radius * 12;

  // Hitbox large enough to click in realistic mode where moons are sub-pixel.
  // IMPORTANT: visible={false} disables Three.js raycasting — use depthWrite={false} instead.
  const hitboxRadius = viewMode === 'realistic'
    ? Math.max(radius * 20, 0.05)
    : radius * 1.5;

  // Label: above mesh on hover, below at rest — mirrors CelestialBody behaviour.
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
    <group position={position}>
      {/* Transparent hitbox — raycastable (visible={false} would skip raycasting) */}
      <mesh {...events} renderOrder={-1}>
        <sphereGeometry args={[hitboxRadius, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Visible moon — events also wired here as fallback */}
      <mesh ref={meshRef} {...events}>
        <sphereGeometry args={[radius, 24, 24]} />
        <meshLambertMaterial
          map={texture || null}
          color={texture ? '#ffffff' : fallbackColor}
        />
      </mesh>

      {/* Hover ring */}
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

      {/* Label — slides up on hover */}
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
  date,
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

  const { data } = useQuery<EphemerisResponse>({
    queryKey: ['moon-ephemeris', parentId, date],
    enabled: hasMoons,
    queryFn: async () => {
      const params = new URLSearchParams({
        date,
        ids: moonIds.join(','),
        center_body: parentId,
      });
      const response = await fetch(`/api/ephemeris?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Moon fetch failed: ${response.status}`);
      }
      return response.json();
    },
    staleTime: 60_000,
  });

  if (!hasMoons || !data?.data) return null;

  const textureTier = resolveTextureTier(tier);

  return (
    <group position={parentPosition}>
      {data.data.map((moon: EphemerisData) => {
        const config = getPlanetConfig(moon.bodyId);
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

        const semiMajorAxis = config.meanDistanceAU * AU_TO_UNIT * orbitScale;
        const moonRadius = getRadius(moon.bodyId, 'MOON', viewMode);

        // Live distance to parent: magnitude of JPL position vector (km, relative to parent)
        const distanceToParentKm = Math.sqrt(
          moon.position.x ** 2 + moon.position.y ** 2 + moon.position.z ** 2
        );

        // Camera travel must target realistic coordinates because double-click switches to realistic mode.
        const realisticWorldPos = {
          x: parentPosition[0] + moonPos[0],
          y: parentPosition[1] + moonPos[1],
          z: parentPosition[2] + moonPos[2],
        };

        const moonPayload = {
          bodyId: moon.bodyId,
          name: config.name,
          englishName: config.englishName,
          position: moon.position,
          velocity: moon.velocity,
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
          // Camera pull-back: 50× the realistic radius, clamped to a minimum so
          // tiny moons (Phobos = 0.000011 u) still frame correctly.
          const realisticRadius = getRadius(moon.bodyId, 'MOON', 'realistic');
          setTravelTarget(realisticWorldPos, Math.max(realisticRadius * 50, 0.005));
        };

        return (
          <group key={moon.bodyId}>
            <OrbitLine
              semiMajorAxis={semiMajorAxis}
              eccentricity={config.eccentricity}
              inclination={config.orbitalInclination}
              longAscNode={config.longAscNode}
              longPerihelion={config.longPerihelion}
              opacity={0.12}
              color="#88aaff"
              viewMode={viewMode}
            />
            <MoonMesh
              name={config.englishName}
              position={scaledMoonPos}
              radius={moonRadius}
              textureUrl={getTexturePath(moon.bodyId, textureTier)}
              rotationSpeed={config.rotationSpeed}
              fallbackColor={config.fallbackColor}
              viewMode={viewMode}
              onClick={handleMoonClick}
              onDoubleClick={handleMoonDoubleClick}
            />
          </group>
        );
      })}
    </group>
  );
}
