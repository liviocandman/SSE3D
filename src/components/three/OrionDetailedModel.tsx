import { useEffect, useMemo } from 'react';
import { type ThreeElements, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { getSharedKTX2Loader } from '@/lib/SingletonKTX2Loader';
import { useQualityTier, type QualityTier } from '@/contexts/QualityTierContext';

type OrionDetailedModelProps = ThreeElements['group'] & {
  targetHeight?: number;
  onReady?: () => void;
};

type OrionDetailedAssetPaths = {
  low: string;
  mid: string;
  high: string;
};

const MODEL_BASE = (
  process.env.NEXT_PUBLIC_MODEL_CDN_URL ?? '/models/orion'
).replace(/\/$/, '');

function getOrionDetailedAssetPaths(name: string): OrionDetailedAssetPaths {
  return {
    low: `${MODEL_BASE}/${name}_low.glb`,
    mid: `${MODEL_BASE}/${name}_medium.glb`,
    high: `${MODEL_BASE}/${name}_high.glb`,
  };
}

const ORION_DETAILED_ASSET_PATHS = getOrionDetailedAssetPaths('artemis_ii');

export function getOrionDetailedAssetPath(tier: QualityTier) {
  return ORION_DETAILED_ASSET_PATHS[tier];
}

function sanitizeMaterial(material: THREE.Material) {
  if (!(material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial)) {
    return;
  }

  const name = material.name.toLowerCase();

  material.envMapIntensity = Math.max(material.envMapIntensity ?? 0, 0.8);
  material.metalness = Math.min(material.metalness ?? 0.5, 0.75);
  material.roughness = Math.max(material.roughness ?? 0.25, 0.2);

  if (name.includes('array') || name.includes('solar')) {
    material.metalness = 0.25;
    material.roughness = 0.35;
    material.envMapIntensity = 0.7;
  }

  if (name.includes('mirror') || name.includes('chrome')) {
    material.metalness = 0.65;
    material.roughness = 0.28;
  }

  material.needsUpdate = true;
}

export function OrionDetailedModel({
  targetHeight = 1,
  onReady,
  ...props
}: OrionDetailedModelProps) {
  const gl = useThree((state) => state.gl);
  const { tier } = useQualityTier();
  const assetPath = getOrionDetailedAssetPath(tier);
  const { scene } = useGLTF(
    assetPath,
    true,
    undefined,
    (loader) => {
      loader.setKTX2Loader(getSharedKTX2Loader(gl));
    }
  );

  const normalizedScene = useMemo(() => {
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const height = size.y || 1;
    const uniformScale = targetHeight / height;

    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      if (Array.isArray(child.material)) {
        child.material.forEach(sanitizeMaterial);
      } else if (child.material) {
        sanitizeMaterial(child.material);
      }
    });

    clone.scale.setScalar(uniformScale);
    clone.position.set(
      -center.x * uniformScale,
      -center.y * uniformScale,
      -center.z * uniformScale
    );

    return clone;
  }, [scene, targetHeight]);

  useEffect(() => {
    onReady?.();
  }, [onReady, normalizedScene]);

  return <primitive object={normalizedScene} {...props} />;
}
