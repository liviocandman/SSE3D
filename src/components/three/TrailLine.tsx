import React, { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { calculateTrailAlpha } from '@/lib/trailUtils';

interface TrailLineProps {
  points: THREE.Vector3[];
  color: string | THREE.Color;
  fadeMode: 'tail' | 'ring';
  opacity?: number;
}

/**
 * GPU-accelerated Trail Line component using BufferGeometry and Vertex Colors.
 * Provides glowing, fading trajectories without CPU overhead for masking.
 */
const TrailLine: React.FC<TrailLineProps> = ({ points, color, fadeMode, opacity = 1.0 }) => {
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const materialRef = useRef<THREE.LineBasicMaterial>(null);

  const baseColor = useMemo(() => new THREE.Color(color), [color]);

  // Pre-calculate positions and vertex colors
  const { positions, colors } = useMemo(() => {
    const posArray = new Float32Array(points.length * 3);
    const colorArray = new Float32Array(points.length * 3);

    points.forEach((point, i) => {
      posArray[i * 3] = point.x;
      posArray[i * 3 + 1] = point.y;
      posArray[i * 3 + 2] = point.z;

      const alpha = calculateTrailAlpha(i, points.length, fadeMode);

      colorArray[i * 3] = baseColor.r * alpha;
      colorArray[i * 3 + 1] = baseColor.g * alpha;
      colorArray[i * 3 + 2] = baseColor.b * alpha;
    });

    return { positions: posArray, colors: colorArray };
  }, [points, baseColor, fadeMode]);

  // Update geometry attributes
  useEffect(() => {
    if (geometryRef.current) {
      geometryRef.current.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometryRef.current.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometryRef.current.computeBoundingSphere();
    }
  }, [positions, colors]);

  // Clean up WebGL resources
  useEffect(() => {
    return () => {
      if (geometryRef.current) geometryRef.current.dispose();
      if (materialRef.current) materialRef.current.dispose();
    };
  }, []);

  const lineRef = useRef<THREE.Line>(null);

  return (
    <line ref={lineRef as any}>
      <bufferGeometry ref={geometryRef} />
      <lineBasicMaterial
        ref={materialRef}
        vertexColors
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </line>
  );
};

export default TrailLine;
