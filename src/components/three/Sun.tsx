'use client';

import { useRef } from 'react';
import { useFrame, useThree, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { SingletonKTX2Loader, getSharedKTX2Loader } from '@/lib/SingletonKTX2Loader';
import { getRadius, KM_TO_UNIT, ViewMode } from '@/lib/scales';
import { getTexturePath, TextureTier } from '@/lib/textureConfig';
import { useQualityTier } from '@/contexts/QualityTierContext';
import { SPHERE_HIGH } from '@/lib/geometryPool';
import { useSolarStore } from '@/store/solarStore';
import { toRelativeRenderUnitsInto } from '@/lib/renderFrame';

interface SunProps {
  lightIntensity?: number;
  viewMode?: ViewMode;
  absolutePositionKm?: { x: number; y: number; z: number };
}

const SUN_BODY_ID = '10';
const DEFAULT_LIGHT_INTENSITY = 2.5;

export function Sun({
  lightIntensity = DEFAULT_LIGHT_INTENSITY,
  viewMode = 'didactic',
  absolutePositionKm = { x: 0, y: 0, z: 0 },
}: SunProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { tier } = useQualityTier();
  const gl = useThree((state) => state.gl);

  // Carregar Textura do Sol (KTX2 Optimized)
  const texturePath = getTexturePath(SUN_BODY_ID, tier as TextureTier);
  const sunTexture = useLoader(SingletonKTX2Loader as unknown as typeof THREE.Loader, texturePath, () => {
    getSharedKTX2Loader(gl);
  }) as THREE.Texture;

  const targetScale = getRadius(SUN_BODY_ID, 'STAR', viewMode);

  useFrame((_, delta) => {
    if (!meshRef.current || !groupRef.current) return;

    const renderOrigin = useSolarStore.getState().renderOrigin;
    toRelativeRenderUnitsInto(groupRef.current.position, absolutePositionKm, renderOrigin, KM_TO_UNIT);

    const currentScale = meshRef.current.scale.x;

    const lerpFactor = 1 - Math.exp(-25 * delta);
    const smoothScale = THREE.MathUtils.lerp(currentScale, targetScale, lerpFactor);

    meshRef.current.scale.setScalar(smoothScale);
    meshRef.current.rotation.y += 0.0005;
  });

  return (
    <group ref={groupRef}>
      {/* SOL VISUAL (A esfera brilhante) 
         Usamos meshBasicMaterial com cor > 1.0 para forçar o Bloom (Brilho Neon)
         sem depender de luzes externas.
      */}
      <mesh ref={meshRef} geometry={SPHERE_HIGH} dispose={null}>
        <meshBasicMaterial
          map={sunTexture}
          color={[3, 2.4, 1.5]} // Multiplicador de HDR (Intensidade do brilho)
          toneMapped           // ACES direto em low; em high/mid o composer aplica ACES após Bloom.
        />
      </mesh>

      {/* LUZ FÍSICA (Iluminação dos planetas)
         Esta luz ilumina a Terra, Júpiter, etc.
      */}
      <pointLight
        position={[0, 0, 0]}
        intensity={lightIntensity}
        distance={0} // Infinito
        decay={0}    // Luz não enfraquece no vácuo
        color="#fff0dd"
      />
    </group>
  );
}
