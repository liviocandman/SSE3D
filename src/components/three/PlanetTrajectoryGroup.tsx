'use client';

import { useMemo } from 'react';
import { useQualityTier } from '@/contexts/QualityTierContext';
import { useSolarStore } from '@/store/solarStore';
import type { TrajectorySegment } from '@/lib/trajectoryEngine';
import { buildTrailSamples } from '@/lib/dynamicTrailBuffers';
import StaticOrbitLine from './StaticOrbitLine';
import DynamicTrailLine from './DynamicTrailLine';

const TRAIL_GRACE_MS = 12 * 60 * 60 * 1000;
const EMPTY_SEGMENTS: TrajectorySegment[] = [];

interface PlanetTrajectoryGroupProps {
  bodyId: string;
}

export function PlanetTrajectoryGroup({ bodyId }: PlanetTrajectoryGroupProps) {
  const { tier } = useQualityTier();
  const selectedSegments = useSolarStore((state) => state.masterTrajectorySegments[bodyId]);
  const fullOrbitData = useSolarStore((state) => state.fullOrbits[bodyId]);
  const segments = selectedSegments ?? EMPTY_SEGMENTS;
  const maxTrailPoints = tier === 'high' ? 240 : tier === 'mid' ? 120 : 60;
  // SPICE supplies 200 samples per block; the old worker subdivided those
  // only on high quality. Preserve that density in the visible GPU window.
  const subdivisions = tier === 'high' ? 8 : 1;
  const samples = useMemo(() => buildTrailSamples(segments), [segments]);

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

      {samples.length >= 2 && (
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
