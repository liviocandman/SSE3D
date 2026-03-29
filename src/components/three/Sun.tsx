'use client';

import { useRef } from 'react';
import { useFrame, useThree, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { KTX2Loader } from 'three-stdlib';
import { getRadius, ViewMode } from '@/lib/scales';
import { getTexturePath, TextureTier } from '@/lib/textureConfig';
import { useQualityTier } from '@/contexts/QualityTierContext';

interface SunProps {
  lightIntensity?: number;
  viewMode?: ViewMode;
}

const SUN_BODY_ID = '10';
const DEFAULT_LIGHT_INTENSITY = 2.5;

import { SPHERE_HIGH } from '@/lib/geometryPool';

// --- Shared Resources (Static) ---
// (Removed localized constant as it is now in geometryPool)

export function Sun({
  lightIntensity = DEFAULT_LIGHT_INTENSITY,
  viewMode = 'didactic',
}: SunProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { tier } = useQualityTier();
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  // Carregar Textura do Sol (KTX2 Optimized)
  const texturePath = getTexturePath(SUN_BODY_ID, tier as TextureTier);
  const sunTexture = useLoader(KTX2Loader, texturePath, (loader) => {
    loader.detectSupport(gl);
    loader.setTranscoderPath('/basis/');
  });

  // Tamanhos de referência
  const didacticRadius = getRadius(SUN_BODY_ID, 'STAR', 'didactic'); // ~35u
  const realisticRadius = getRadius(SUN_BODY_ID, 'STAR', 'realistic'); // ~0.7u

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    let targetScale;

    if (viewMode === 'didactic') {
      // MODO DIDÁTICO: Tamanho fixo e grande
      targetScale = didacticRadius;
    } else {
      // MODO REALISTA (O Truque da Escala Dinâmica)

      // 1. Calcular distância da câmera ao Sol (0,0,0)
      const distance = camera.position.length();

      // 2. Definir um fator de escala visual
      // "distance / 500" significa: a cada 500 unidades de distância, o sol ganha 1 unidade de tamanho visual.
      // Isso mantém ele visível como um disco pequeno no céu de Netuno (~12 units).
      const visualScale = distance / 500;

      // 3. Clamp (Trava de segurança)
      // Nunca deixe o sol ficar menor que o tamanho real (0.7)
      // Nunca deixe ele ficar colossalmente grande a ponto de engolir a Terra se estivermos perto
      targetScale = Math.max(realisticRadius, visualScale);
    }

    const currentScale = meshRef.current.scale.x;

    // NOVA FÓRMULA SEGURA: 
    const lerpFactor = 1 - Math.exp(-25 * delta);
    const smoothScale = THREE.MathUtils.lerp(currentScale, targetScale, lerpFactor);

    meshRef.current.scale.setScalar(smoothScale);
    meshRef.current.rotation.y += 0.0005;
  });

  return (
    <group>
      {/* SOL VISUAL (A esfera brilhante) 
         Usamos meshBasicMaterial com cor > 1.0 para forçar o Bloom (Brilho Neon)
         sem depender de luzes externas.
      */}
      <mesh ref={meshRef} geometry={SPHERE_HIGH} dispose={null}>
        <meshBasicMaterial
          map={sunTexture}
          color={[3, 2.4, 1.5]} // Multiplicador de HDR (Intensidade do brilho)
          toneMapped={false}    // Importante: Permite cores "estouradas" para o Bloom
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