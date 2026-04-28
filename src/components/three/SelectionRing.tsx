'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TORUS_SELECTION } from '@/lib/geometryPool';

interface SelectionRingProps {
  position: [number, number, number];
  radius: number;
}

export function SelectionRing({ position, radius }: SelectionRingProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;

    // Smooth rotation
    meshRef.current.rotation.z += 0.01;

    // Subtle pulse
    const scale = (radius * 1.5) * (1 + Math.sin(state.clock.elapsedTime * 3) * 0.05);
    meshRef.current.scale.set(scale, scale, scale);
  });

  return (
    <mesh ref={meshRef} position={position} rotation={[Math.PI / 2, 0, 0]} geometry={TORUS_SELECTION} dispose={null}>
      <meshBasicMaterial
        color="#ffffff"
        transparent
        opacity={0.6}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
