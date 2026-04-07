import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { KM_TO_UNIT } from '@/lib/scales';
import { calculateTrailAlpha } from '@/lib/trailUtils';

interface TrailLineProps {
  /** Points to render. If renderOrigin is provided, these should be absolute KM. Otherwise, they are assumed to be in local render units. */
  points: THREE.Vector3[];
  color: string | THREE.Color;
  fadeMode: 'tail' | 'ring';
  opacity?: number;
  lineWidth?: number;
  /** Optional absolute origin to subtract from points (KM). If provided, points MUST be absolute KM. */
  renderOrigin?: { x: number; y: number; z: number };
}

export const TrailLine: React.FC<TrailLineProps> = ({
  points,
  color,
  fadeMode,
  opacity = 1.0,
  lineWidth = 2,
  renderOrigin,
}) => {
  // 1. ANTI-NaN & DUPLICATE SHIELD (Prevents vertex corruption on iOS/WebKit)
  const safePoints = useMemo(() => {
    return points.map(p => {
        if (!renderOrigin) return p;
        return new THREE.Vector3(
            p.x - (renderOrigin.x * KM_TO_UNIT),
            p.y - (renderOrigin.y * KM_TO_UNIT),
            p.z - (renderOrigin.z * KM_TO_UNIT)
        );
    }).filter((p, i, arr) => {
      // Filter out invalid coordinates (NaN/Infinity) that crash WebKit buffers
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        !Number.isFinite(p.z)
      ) {
        return false;
      }

      // Filter out overlapping points that cause division-by-zero 
      // artifacts ("Spider Webs") on iOS
      if (i > 0) {
        const prev = arr[i - 1];
        const distSq = p.distanceToSquared(prev);
        if (distSq < 1e-10) return false;
      }

      return true;
    });
  }, [points, renderOrigin]);

  // 2. MEMORY OPTIMIZATION (Use basic RGB tuples to reduce Safari GC overhead)
  const vertexColors = useMemo(() => {
    if (safePoints.length < 2) return [];

    const baseColor = new THREE.Color(color);
    const fadeColor = new THREE.Color(0x000000); // Fades toward black
    const tempColor = new THREE.Color();

    return safePoints.map((_, i) => {
      const alpha = calculateTrailAlpha(i, safePoints.length, fadeMode);
      tempColor.copy(baseColor).lerp(fadeColor, 1 - alpha);

      // Return [r, g, b] tuples instead of Color objects for better mobile stability
      return [tempColor.r, tempColor.g, tempColor.b] as [number, number, number];
    });
  }, [safePoints, color, fadeMode]);

  // Don't render if there isn't enough clean data
  if (safePoints.length < 2) return null;

  return (
    <Line
      points={safePoints}
      vertexColors={vertexColors}
      transparent
      opacity={opacity}
      lineWidth={lineWidth}
      depthWrite={false}
      // 3. INVISIBILITY CURE (iOS Frustum Fix)
      // Disables frustum culling to prevent lines from disappearing when the 
      // bounding box calculation fails during rapid array size changes on iOS.
      frustumCulled={false}
    />
  );
};

export default TrailLine;
