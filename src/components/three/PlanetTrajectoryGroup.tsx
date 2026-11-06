'use client';

import { useMemo } from 'react';
import { useQualityTier } from '@/contexts/QualityTierContext';
import { useSolarStore } from '@/store/solarStore';
import type { EphemerisTrajectory } from '@/lib/types';
import type { TrailSample } from '@/lib/dynamicTrailBuffers';
import { parseTimestampMs } from '@/lib/utils';
import StaticOrbitLine from './StaticOrbitLine';
import DynamicTrailLine from './DynamicTrailLine';

const TRAIL_GRACE_MS = 12 * 60 * 60 * 1000;
const EMPTY_TRAJECTORY: EphemerisTrajectory[] = [];

interface PlanetTrajectoryGroupProps {
  bodyId: string;
}

export function PlanetTrajectoryGroup({ bodyId }: PlanetTrajectoryGroupProps) {
  const { tier } = useQualityTier();
  const selectedTrajectory = useSolarStore((state) => state.masterTrajectory[bodyId]);
  const fullOrbitData = useSolarStore((state) => state.fullOrbits[bodyId]);
  const allPoints = selectedTrajectory ?? EMPTY_TRAJECTORY;
  const maxTrailPoints = tier === 'high' ? 240 : tier === 'mid' ? 120 : 60;
  // SPICE supplies 200 samples per block; the old worker subdivided those
  // only on high quality. Preserve that density in the visible GPU window.
  const subdivisions = tier === 'high' ? 8 : 1;
  const samples = useMemo(() => {
    const result: TrailSample[] = [];
    for (const sample of allPoints) {
      const point = sample.position;
      const timestampMs = parseTimestampMs(sample.timestamp);
      if (!Number.isFinite(timestampMs) || !Number.isFinite(point.x)
        || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
      const previous = result[result.length - 1]?.point;
      if (previous && (point.x - previous.x) ** 2 + (point.y - previous.y) ** 2
        + (point.z - previous.z) ** 2 < 0.000001) continue;
      // Share the scientific position object; rendering only needs x/y/z.
      result.push({ timestampMs, point });
    }
    return result;
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
          subdivisions={subdivisions}
          graceMs={TRAIL_GRACE_MS}
          color="#a3cffe"
          opacity={0.8}
          lineWidth={1.5}
        />
      )}
    </group>
  );
}
