import React, { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { KM_TO_UNIT } from '@/lib/scales';
import type { EphemerisTrajectory } from '@/lib/types';

interface StaticOrbitLineProps {
  trajectory: EphemerisTrajectory[];
  color: string | THREE.Color;
  opacity?: number;
}

/**
 * High-performance solid orbit line using BufferGeometry and THREE.LineLoop.
 * Renders the full 360-degree orbital path based on NASA ephemeris.
 */
const StaticOrbitLine: React.FC<StaticOrbitLineProps> = ({ 
  trajectory, 
  color, 
  opacity = 0.15 
}) => {
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const materialRef = useRef<THREE.LineBasicMaterial>(null);

  // Convert trajectory to Float32Array positions
  const positions = useMemo(() => {
    const posArray = new Float32Array(trajectory.length * 3);
    trajectory.forEach((p, i) => {
      posArray[i * 3] = p.position.x * KM_TO_UNIT;
      posArray[i * 3 + 1] = p.position.y * KM_TO_UNIT;
      posArray[i * 3 + 2] = p.position.z * KM_TO_UNIT;
    });
    return posArray;
  }, [trajectory]);

  // Update geometry attributes
  useEffect(() => {
    if (geometryRef.current) {
      geometryRef.current.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometryRef.current.computeBoundingSphere();
    }
  }, [positions]);

  // Clean up WebGL resources
  useEffect(() => {
    return () => {
      if (geometryRef.current) geometryRef.current.dispose();
      if (materialRef.current) materialRef.current.dispose();
    };
  }, []);

  return (
    <lineLoop>
      <bufferGeometry ref={geometryRef} />
      <lineBasicMaterial
        ref={materialRef}
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </lineLoop>
  );
};

export default StaticOrbitLine;
