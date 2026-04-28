'use client';

import { useMemo } from 'react';
import { useQualityTier } from '@/contexts/QualityTierContext';
import { useSolarStore } from '@/store/solarStore';
import {
  type TrajectorySegment,
  flattenTrajectorySegments,
} from '@/lib/trajectoryEngine';
import { parseTimestampMs } from '@/lib/utils';
import StaticOrbitLine from './StaticOrbitLine';
import DynamicTrailLine from './DynamicTrailLine';
import * as THREE from 'three';

const TRAIL_GRACE_MS = 12 * 60 * 60 * 1000;
const EMPTY_TRAJECTORY_SEGMENTS: TrajectorySegment[] = [];

interface PlanetTrajectoryGroupProps {
  bodyId: string;
}

export function PlanetTrajectoryGroup({ bodyId }: PlanetTrajectoryGroupProps) {
  const { tier } = useQualityTier();
  const selectedSegments = useSolarStore((state) => state.masterTrajectorySegments[bodyId]);
  const fullOrbitData = useSolarStore((state) => state.fullOrbits[bodyId]);
  const segments = selectedSegments ?? EMPTY_TRAJECTORY_SEGMENTS;
  const maxTrailPoints = tier === 'high' ? 240 : tier === 'mid' ? 120 : 60;
  const allPoints = useMemo(() => flattenTrajectorySegments(segments), [segments]);

  const samples = useMemo(() => {
    return allPoints.map((p) => {
      // Pass absolute KM positions
      return {
        timestampMs: parseTimestampMs(p.timestamp),
        point: new THREE.Vector3(p.position.x, p.position.y, p.position.z),
      };
    }).filter((s, i, arr) => {
      // Anti-NaN & Duplicate Shield (from TrailLine logic)
      if (!Number.isFinite(s.point.x) || !Number.isFinite(s.point.y) || !Number.isFinite(s.point.z)) {
        return false;
      }
      if (i > 0 && s.point.distanceToSquared(arr[i - 1].point) < 0.000001) {
        return false;
      }
      return true;
    });
  }, [allPoints]);

  return (
    <group>
      {fullOrbitData && (
        <StaticOrbitLine
          trajectory={fullOrbitData}
          color="#a3cffe"
          opacity={0.05}
          lineWidth={0.5}
        />
      )}

      {samples.length > 2 && (
        <DynamicTrailLine
          samples={samples}
          maxTrailPoints={maxTrailPoints}
          graceMs={TRAIL_GRACE_MS}
          color="#a3cffe"
          opacity={0.8}
          lineWidth={1.5}
        />
      )}
    </group>
  );
}
