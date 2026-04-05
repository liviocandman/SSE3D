import { useEffect, useMemo } from 'react';
import { type ThreeElements, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { getSharedKTX2Loader } from '@/lib/SingletonKTX2Loader';

type OrionDetailedModelProps = ThreeElements['group'] & {
  targetHeight?: number;
  onReady?: () => void;
};

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
  const { scene } = useGLTF(
    '/models/orion/orion-detailed.glb',
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
