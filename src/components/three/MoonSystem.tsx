'use client';

import { useRef, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
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
import { sampleTrajectoryAtTime } from '@/lib/trajectoryEngine';
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
  const masterSegments = useSolarStore(useShallow(state => state.masterTrajectorySegments[bodyId] || []));
  
  // Load texture asynchronously
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

    if (groupRef.current && masterSegments.length > 0) {
      const SCALE = (1 / 1_000_000) * orbitScale;
      const sampled = sampleTrajectoryAtTime(masterSegments, simTime);
      
      if (sampled) {
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
      meshRef.current.rotation.y += rotationSpeed * 60 * delta * (isPlaying ? timeMultiplier : 1);
    }
  });

  const fontSize = viewMode === 'didactic' ? radius * 0.8 : radius * 12;
  const hitboxRadius = viewMode === 'realistic' ? Math.max(radius * 20, 0.05) : radius * 1.5;
  const labelY = isHovered ? radius * 1.8 : -radius * 1.8;
  const labelColor = isHovered ? '#ffffff' : '#8ab4d8';
  const labelAnchorY = isHovered ? 'bottom' : 'top';

  const handleClick = () => {
    onClick();
  };
  const handleDoubleClick = () => {
    onDoubleClick();
  };
  const handlePointerEnter = () => {
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

  const isDataLoading = masterSegments.length === 0;
  const currentRadius = isDataLoading ? 0 : radius;

  return (
    <group name={name} ref={groupRef}>
      <mesh {...events} geometry={HITBOX_SPHERE} scale={isDataLoading ? 0 : hitboxRadius} renderOrder={-1} dispose={null}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh ref={meshRef} {...events} geometry={SPHERE_MID} scale={currentRadius} dispose={null}>
        <meshLambertMaterial
          map={texture || null}
          color={texture ? '#ffffff' : fallbackColor}
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

        const orbitScale = getMoonOrbitScale(
          parentId,
          parentClass,
          config.meanDistanceAU * AU_TO_KM,
          viewMode
        );

        const moonRadius = getRadius(moonId, 'MOON', viewMode);
        const moonTrajectory = useSolarStore.getState().masterTrajectory[moonId];
        
        const currentPos = moonTrajectory && moonTrajectory.length > 0 
          ? moonTrajectory[0].position 
          : { x: 0, y: 0, z: 0 };

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

  // Sem dados da NASA? Não desenha a linha (a transição de 20ms que criámos)
  if (!config || !moonTrajectory || moonTrajectory.length < 2) return null;

  const orbitScale = getMoonOrbitScale(parentId, parentClass, config.meanDistanceAU * AU_TO_KM, viewMode);
  const SCALE = (1 / 1_000_000) * orbitScale;

  // 1. A Matemática da Fração
  const trajectorySpanDays = 30; // O Backend devolve blocos de 30 dias
  const orbitalPeriodDays = config.orbitalPeriod || 30;
  
  // Quantas voltas esta lua dá em 30 dias?
  const orbitsInSpan = trajectorySpanDays / orbitalPeriodDays;
  
  let pointsToTake = moonTrajectory.length;
  let isClosed = false;

  if (orbitsInSpan >= 1.0) {
    // A lua completa pelo menos 1 volta. 
    // Pegamos EXATAMENTE os pontos de 1 volta (100%), sem excessos.
    const orbitFraction = 1 / orbitsInSpan;
    pointsToTake = Math.ceil(moonTrajectory.length * orbitFraction);
    
    // Como temos dados suficientes, fechamos o anel no Three.js
    isClosed = true; 
  } else {
    // A lua é muito lenta (ex: Iapetus demora 79 dias).
    // Vai desenhar apenas o arco parcial dos 30 dias que temos na RAM.
    isClosed = false; 
  }

  const rawPoints: THREE.Vector3[] = [];
  for (let i = 0; i < pointsToTake; i++) {
    const t = moonTrajectory[i];
    const p = new THREE.Vector3(t.position.x * SCALE, t.position.y * SCALE, t.position.z * SCALE);
    
    // ESCUDO DE COORDENADAS: Evita colisões de cálculo na GPU
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    if (rawPoints.length > 0 && p.distanceToSquared(rawPoints[rawPoints.length - 1]) < 0.000001) continue;
    
    rawPoints.push(p);
  }

  // 2. SUAVIZAÇÃO ALGORÍTMICA (O fim dos nós)
  let finalPoints = rawPoints;
  // Segurança: CatmullRom precisa de pelo menos 2 pontos (linha) ou 4 pontos (Spline fechada)
  if (rawPoints.length >= 4) {
    try {
      const curve = new THREE.CatmullRomCurve3(rawPoints, isClosed);
      // Mantemos a alta definição. 256 pontos é barato para GPU e resolve luas grandes.
      finalPoints = curve.getPoints(256); 
    } catch {
      console.warn(`[MoonOrbitLine] Curve generation failed for ${moonId}, using raw points.`);
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
