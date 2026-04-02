import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { calculateTrailAlpha } from '@/lib/trailUtils';
import { useSolarStore } from '@/store/solarStore';

interface DynamicTrailLineProps {
  samples: { timestampMs: number; point: THREE.Vector3 }[];
  maxTrailPoints: number;
  color: string | THREE.Color;
  opacity?: number;
  lineWidth?: number;
  graceMs?: number;
}

// @react-three/drei's Line uses a custom material/geometry. 
// We cast the ref to a generic THREE.Mesh to access geometry and computeLineDistances.
type LineMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material> & {
  computeLineDistances: () => void;
};

export const DynamicTrailLine: React.FC<DynamicTrailLineProps> = ({
  samples,
  maxTrailPoints,
  color,
  opacity = 0.8,
  lineWidth = 1.5,
  graceMs = 12 * 60 * 60 * 1000,
}) => {
  const lineRef = useRef<LineMesh>(null);
  
  // Reusable Color objects stored in refs to avoid GC allocations in the frame loop
  const baseColor = useRef(new THREE.Color(color));
  const fadeColor = useRef(new THREE.Color(0x000000));
  const scratchColor = useRef(new THREE.Color());

  // Performance: Pre-allocate typed arrays for the GPU buffers
  const posBuffer = useRef(new Float32Array(maxTrailPoints * 3));
  const colBuffer = useRef(new Float32Array(maxTrailPoints * 3));

  // Sync color changes to the ref
  useEffect(() => {
    baseColor.current.set(color);
  }, [color]);

  // Handle quality tier changes / buffer resizing
  useEffect(() => {
    if (posBuffer.current.length !== maxTrailPoints * 3) {
      posBuffer.current = new Float32Array(maxTrailPoints * 3);
      colBuffer.current = new Float32Array(maxTrailPoints * 3);
    }
  }, [maxTrailPoints]);

  // Minimal initial points to satisfy Line's constructor without creating memory pressure
  const initialPoints = useMemo(() => [[0, 0, 0], [0, 0, 0]] as [number, number, number][], []);

  useFrame(() => {
    if (!lineRef.current) return;

    const currentTime = useSolarStore.getState().currentTime;
    const simTimeMs = currentTime.getTime();
    const cutoffMs = simTimeMs + graceMs;

    let left = 0;
    let right = samples.length - 1;
    let lastVisibleIndex = -1;

    // Binary search for the cutoff
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (samples[mid].timestampMs <= cutoffMs) {
        lastVisibleIndex = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    if (lastVisibleIndex < 1) {
      lineRef.current.visible = false;
      return;
    }

    const startIndex = Math.max(0, lastVisibleIndex - maxTrailPoints + 1);
    const count = lastVisibleIndex - startIndex + 1;

    if (count < 2) {
      lineRef.current.visible = false;
      return;
    }

    lineRef.current.visible = true;

    const pos = posBuffer.current;
    const col = colBuffer.current;
    const bc = baseColor.current;
    const fc = fadeColor.current;
    const sc = scratchColor.current;

    for (let i = 0; i < count; i++) {
      const p = samples[lastVisibleIndex - i].point;
      const idx = i * 3;

      // Direct write into pre-allocated Float32Array (Zero allocation)
      pos[idx] = p.x;
      pos[idx + 1] = p.y;
      pos[idx + 2] = p.z;

      const alpha = calculateTrailAlpha(i, count, 'tail');
      sc.copy(bc).lerp(fc, 1 - alpha);
      
      col[idx] = sc.r;
      col[idx + 1] = sc.g;
      col[idx + 2] = sc.b;
    }

    // Direct mutation without triggering React renders
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = lineRef.current.geometry as any; 
    if (geometry.setPositions && geometry.setColors) {
      // Use subarray to provide a view of the buffer (Zero allocation)
      geometry.setPositions(pos.subarray(0, count * 3));
      geometry.setColors(col.subarray(0, count * 3));
      
      // Notify Three.js that the attributes need an update
      geometry.attributes.instanceStart.needsUpdate = true;
      geometry.attributes.instanceEnd.needsUpdate = true;
    }
    
    lineRef.current.computeLineDistances();
  });

  return (
    <Line
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={lineRef as any}
      points={initialPoints} 
      vertexColors={[[1, 1, 1], [1, 1, 1]]} // Placeholder colors
      transparent
      opacity={opacity}
      lineWidth={lineWidth}
      depthWrite={false}
      frustumCulled={false}
    />
  );
};

export default DynamicTrailLine;
