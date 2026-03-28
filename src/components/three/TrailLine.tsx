import React, { useMemo } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { getTrailVertexColors } from '@/lib/trailUtils';

interface TrailLineProps {
  points: THREE.Vector3[];
  color: string | THREE.Color;
  fadeMode: 'tail' | 'ring';
  opacity?: number;
  lineWidth?: number;
}

/**
 * Volumetric trail line built with drei's Line2 implementation.
 * Uses vertex colors to fade older points toward black for a comet-tail effect.
 */
const TrailLine: React.FC<TrailLineProps> = ({
  points,
  color,
  fadeMode,
  opacity = 0.8,
  lineWidth = 2.5,
}) => {
  const vertexColors = useMemo(() => {
    return getTrailVertexColors(points.length, color, fadeMode);
  }, [points.length, color, fadeMode]);

  if (points.length < 2) return null;

  return (
    <Line
      points={points}
      vertexColors={vertexColors}
      lineWidth={lineWidth}
      transparent
      opacity={opacity}

      depthWrite={false}
    />
  );
};

export default TrailLine;
