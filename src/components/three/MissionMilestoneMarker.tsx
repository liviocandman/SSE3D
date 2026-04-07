'use client';

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text, Line } from '@react-three/drei';
import * as THREE from 'three';
import { KM_TO_UNIT } from '@/lib/scales';

interface MissionMilestoneMarkerProps {
  label: string;
  position: [number, number, number];
  opacity?: number;
}

export const MissionMilestoneMarker: React.FC<MissionMilestoneMarkerProps> = ({
  label,
  position,
  opacity: initialOpacity = 1,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const lineRef = useRef<(THREE.Object3D & { material?: { opacity: number } }) | null>(null);
  const textRef = useRef<{ fillOpacity: number } | null>(null);
  const diamondRef = useRef<THREE.Mesh>(null);
  const worldPositionRef = useRef(new THREE.Vector3());

  // Internal values to avoid React state updates in useFrame
  const opacityRef = useRef(0);

  useFrame((state) => {
    if (!groupRef.current) return;

    // Position is Earth-relative KM from SceneManager
    // Since this component is a child of CelestialBody (Earth), 
    // it is already in the relative frame. 
    // We only need to scale KM to render units.
    const relX = position[0] * KM_TO_UNIT;
    const relY = position[1] * KM_TO_UNIT;
    const relZ = position[2] * KM_TO_UNIT;

    const t = state.clock.getElapsedTime();

    // Apply relative position + breathing
    groupRef.current.position.set(relX, relY + Math.sin(t * 2) * 0.001, relZ);

    const worldPos = groupRef.current.getWorldPosition(worldPositionRef.current);
    const dist = state.camera.position.distanceTo(worldPos);
    const fadeStart = 0.8;
    const fadeEnd = 0.2;
    let targetOpacity = 0;
    if (dist < fadeStart) {
      targetOpacity = THREE.MathUtils.smoothstep(dist, fadeStart, fadeEnd) * initialOpacity;
    }

    // Smooth lerp for opacity
    opacityRef.current = THREE.MathUtils.lerp(opacityRef.current, targetOpacity, 0.1);

    // 3. Direct Material/Prop updates 
    const currentOp = opacityRef.current;
    const isVisible = currentOp > 0.01;

    groupRef.current.visible = isVisible;
    if (isVisible) {
      if (lineRef.current?.material) {
        lineRef.current.material.opacity = currentOp * 0.3;
      }
      if (textRef.current) textRef.current.fillOpacity = currentOp * 0.8;
      if (diamondRef.current && diamondRef.current.material) {
        (diamondRef.current.material as THREE.MeshBasicMaterial).opacity = currentOp * 0.6;
      }
    }
  });

  return (
    <group ref={groupRef} position={position} visible={false}>
      {/* Vertical pointer line */}
      <Line
        ref={(value) => {
          lineRef.current = value as (THREE.Object3D & { material?: { opacity: number } }) | null;
        }}
        points={[[0, 0, 0], [0, 0.05, 0]]}
        color="#00ffff"
        lineWidth={1}
        transparent
        opacity={0}
      />

      {/* Milestone Label */}
      <Billboard position={[0, 0.06, 0]}>
        <Text
          ref={textRef}
          color="#00ffff"
          fontSize={0.015}
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.002}
          outlineColor="#000000"
          fillOpacity={0}
        >
          {label.toUpperCase()}
        </Text>

        {/* Decorative diamond at base of label */}
        <mesh ref={diamondRef} position={[0, -0.005, 0]} rotation={[0, 0, Math.PI / 4]}>
          <planeGeometry args={[0.005, 0.005]} />
          <meshBasicMaterial color="#00ffff" transparent opacity={0} side={THREE.DoubleSide} />
        </mesh>
      </Billboard>
    </group>
  );
};
