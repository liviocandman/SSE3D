import React, { useMemo } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { KM_TO_UNIT } from '@/lib/scales';
import type { EphemerisTrajectory } from '@/lib/types';

interface StaticOrbitLineProps {
  trajectory: EphemerisTrajectory[];
  color: string | THREE.Color;
  opacity?: number;
}

/**
 * Full static orbit path rendered as a thin ghost line.
 */
const StaticOrbitLine: React.FC<StaticOrbitLineProps> = ({ 
  trajectory, 
  color, 
  opacity = 0.12 
}) => {
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

  if (points.length < 2) return null;

  return (
    <Line
      points={points}
      color={color}
      lineWidth={1}
      transparent
      opacity={opacity}
      depthWrite={false}
    />
  );
};

export default StaticOrbitLine;
