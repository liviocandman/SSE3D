'use client';

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text, Line } from '@react-three/drei';
import * as THREE from 'three';

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
  const lineRef = useRef<any>(null);
  const textRef = useRef<any>(null);
  const diamondRef = useRef<THREE.Mesh>(null);
  const worldPositionRef = useRef(new THREE.Vector3());
  
  // Internal values to avoid React state updates in useFrame
  const opacityRef = useRef(0);

  useFrame((state) => {
    if (!groupRef.current) return;
    
    const t = state.clock.getElapsedTime();
    const worldPos = groupRef.current.getWorldPosition(worldPositionRef.current);
    const dist = state.camera.position.distanceTo(worldPos);

    // 1. Position Breathing Animation
    groupRef.current.position.y = position[1] + Math.sin(t * 2) * 0.001;

    // 2. Distance-based Fade Logic
    const fadeStart = 0.8;
    const fadeEnd = 0.2;
    let targetOpacity = 0;
    if (dist < fadeStart) {
      targetOpacity = THREE.MathUtils.smoothstep(dist, fadeStart, fadeEnd) * initialOpacity;
    }

    // Smooth lerp for opacity
    opacityRef.current = THREE.MathUtils.lerp(opacityRef.current, targetOpacity, 0.1);

    // 3. Direct Material/Prop updates (P1 fix: no useState)
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
        ref={lineRef}
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
