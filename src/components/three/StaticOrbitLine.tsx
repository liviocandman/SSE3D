import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { KM_TO_UNIT } from '@/lib/scales';
import type { EphemerisTrajectory } from '@/lib/types';

import { useSolarStore } from '@/store/solarStore';

interface StaticOrbitLineProps {
  trajectory: EphemerisTrajectory[];
  color: string | THREE.Color;
  opacity?: number;
  lineWidth?: number;
}

/**
 * Full static orbit path rendered as a thin ghost line.
 */
const StaticOrbitLine: React.FC<StaticOrbitLineProps> = ({ 
  trajectory, 
  color, 
  opacity = 0.05,
  lineWidth = 0.5,
}) => {
  const groupRef = React.useRef<THREE.Group>(null);

  const points = useMemo(() => {
    const converted = trajectory.map((p) => new THREE.Vector3(
      p.position.x * KM_TO_UNIT,
      p.position.y * KM_TO_UNIT,
      p.position.z * KM_TO_UNIT
    ));

    // Close the orbit loop for a seamless full-cycle path.
    if (converted.length > 2) {
      converted.push(converted[0].clone());
    }

    return converted;
  }, [trajectory]);

  useFrame(() => {
    if (!groupRef.current) return;
    const renderOrigin = useSolarStore.getState().renderOrigin;
    groupRef.current.position.set(
      -renderOrigin.x * KM_TO_UNIT,
      -renderOrigin.y * KM_TO_UNIT,
      -renderOrigin.z * KM_TO_UNIT
    );
  });

  if (points.length < 2) return null;

  return (
    <group ref={groupRef}>
      <Line
        points={points}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </group>
  );
};

export default StaticOrbitLine;
