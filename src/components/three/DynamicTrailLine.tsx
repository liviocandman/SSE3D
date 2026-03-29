import React, { useRef, useMemo } from 'react';
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

export const DynamicTrailLine: React.FC<DynamicTrailLineProps> = ({
  samples,
  maxTrailPoints,
  color,
  opacity = 0.8,
  lineWidth = 1.5,
  graceMs = 12 * 60 * 60 * 1000,
}) => {
  const lineRef = useRef<any>(null);
  const baseColor = useMemo(() => new THREE.Color(color), [color]);
  const fadeColor = useMemo(() => new THREE.Color(0x000000), []);

  // Pre-allocate fixed buffers for the maximum possible points
  // Line from @react-three/drei uses LineGeometry (Fat Lines) which requires specific buffer management
  const [initialPoints, initialColors] = useMemo(() => {
    const pts = [];
    const cls = [];
    for (let i = 0; i < maxTrailPoints; i++) {
      pts.push(new THREE.Vector3(0, 0, 0));
      cls.push([1, 1, 1] as [number, number, number]);
    }
    return [pts, cls];
  }, [maxTrailPoints]);

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

    const positions: number[] = [];
    const colors: number[] = [];
    const tempColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const p = samples[lastVisibleIndex - i].point;
      positions.push(p.x, p.y, p.z);

      const alpha = calculateTrailAlpha(i, count, 'tail');
      tempColor.copy(baseColor).lerp(fadeColor, 1 - alpha);
      colors.push(tempColor.r, tempColor.g, tempColor.b);
    }

    // Direct mutation without triggering React renders
    // We update the geometry with the current segment of the trail
    lineRef.current.geometry.setPositions(positions);
    lineRef.current.geometry.setColors(colors);
    
    // Important: LineGeometry doesn't use setDrawRange in the same way as BufferGeometry
    // but setPositions/setColors will update the internal buffers correctly.
    // If the count changed, we might need to tell Three.js to re-evaluate the bounding box
    lineRef.current.computeLineDistances();
  });

  return (
    <Line
      ref={lineRef}
      points={initialPoints} 
      vertexColors={initialColors}
      transparent
      opacity={opacity}
      lineWidth={lineWidth}
      depthWrite={false}
      frustumCulled={false}
    />
  );
};

export default DynamicTrailLine;
