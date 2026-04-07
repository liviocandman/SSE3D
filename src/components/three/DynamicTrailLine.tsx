import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { calculateTrailAlpha } from '@/lib/trailUtils';
import { toRelativeRenderUnitsInto } from '@/lib/renderFrame';
import { KM_TO_UNIT } from '@/lib/scales';
import { useSolarStore } from '@/store/solarStore';
import { findTemporalInterval, createTemporalLookupCache, resetCacheIfDataChanged } from '@/lib/temporalLookup';

interface DynamicTrailLineProps {
  /** Absolute positions in KM */
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

/**
 * DynamicTrailLine Component
 * 
 * SCOPE: Exclusive for planets and moons.
 * DO NOT use this for spacecraft or mission trajectories.
 * Spacecraft trajectories should use MissionTrajectoryLine.
 * 
 * Provides a performant, GPU-accelerated trail line that fades based on simulation time.
 */
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

  // --- Phase 3: Monotonic Temporal Lookup Cache ---
  const lookupCache = useRef(createTemporalLookupCache());
  
  // Extract pointTimesMs for the temporal lookup (Array of numbers is required for cache)
  const pointTimesMs = useMemo(() => samples.map(s => s.timestampMs), [samples]);

  useEffect(() => {
    resetCacheIfDataChanged(lookupCache.current, pointTimesMs);
  }, [pointTimesMs]);

  // Minimal initial points to satisfy Line's constructor without creating memory pressure
  const initialPoints = useMemo(() => [[0, 0, 0], [0, 0, 0]] as [number, number, number][], []);

  const scratchVec = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!lineRef.current) return;

    const currentTime = useSolarStore.getState().currentTime;
    const simTimeMs = currentTime.getTime();
    const cutoffMs = simTimeMs + graceMs;

    let lastVisibleIndex = -1;
    const len = pointTimesMs.length;
    
    if (len > 0) {
      if (cutoffMs >= pointTimesMs[len - 1]) {
        lastVisibleIndex = len - 1;
      } else {
        const interval = findTemporalInterval(pointTimesMs, cutoffMs, lookupCache.current);
        if (interval) {
          lastVisibleIndex = interval.leftIndex;
        } else {
          // If cutoff is exactly at the first point or just weirdly behaving:
          lastVisibleIndex = cutoffMs >= pointTimesMs[0] ? 0 : -1;
        }
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

    const solarState = useSolarStore.getState();
    const renderOrigin = solarState.renderOrigin;

    for (let i = 0; i < count; i++) {
      const p = samples[lastVisibleIndex - i].point;
      const idx = i * 3;

      // Convert absolute KM to relative render units (Zero allocation)
      toRelativeRenderUnitsInto(scratchVec.current, p, renderOrigin, KM_TO_UNIT);
      pos[idx] = scratchVec.current.x;
      pos[idx + 1] = scratchVec.current.y;
      pos[idx + 2] = scratchVec.current.z;

      const alpha = calculateTrailAlpha(i, count, 'tail');
      sc.copy(bc).lerp(fc, 1 - alpha);
      
      col[idx] = sc.r;
      col[idx + 1] = sc.g;
      col[idx + 2] = sc.b;
    }

    // Direct mutation without triggering React renders
    const geometry = lineRef.current.geometry as unknown as {
      setPositions: (array: Float32Array) => void;
      setColors: (array: Float32Array) => void;
      attributes: Record<string, { needsUpdate: boolean }>;
    };
    if (geometry.setPositions && geometry.setColors) {
      // Use subarray to provide a view of the buffer (Zero allocation)
      geometry.setPositions(pos.subarray(0, count * 3));
      geometry.setColors(col.subarray(0, count * 3));
      
      // Notify Three.js that the attributes need an update
      if (geometry.attributes.instanceStart) geometry.attributes.instanceStart.needsUpdate = true;
      if (geometry.attributes.instanceEnd) geometry.attributes.instanceEnd.needsUpdate = true;
    }
    
    lineRef.current.computeLineDistances();
  });

  return (
    <Line
      ref={lineRef as unknown as NonNullable<React.ComponentProps<typeof Line>["ref"]>}
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
