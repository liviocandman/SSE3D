'use client';

import { useShallow } from 'zustand/react/shallow';
import { useSolarStore } from '@/store/solarStore';
import { useDisplayTime } from './useDisplayTime';
import { clockRuntime } from '@/lib/time/clockRuntime';
import { sampleTrajectoryAtTime, sampleTrajectoryStateAtTime, type TrajectorySegment } from '@/lib/trajectoryEngine';
import { selectSegmentsAtTime } from '@/lib/simulation/trajectoryQueries';
import { BODY_IDS, type SelectedPlanet } from '@/lib/types';
import { getPlanetConfig } from '@/lib/textureConfig';
import { getRadius, KM_TO_UNIT } from '@/lib/scales';

function getHeldTimestamp(segments: TrajectorySegment[], timeMs: number) {
  const held = sampleTrajectoryAtTime(segments, timeMs);
  return held ? segments[held.segmentIndex]?.points[held.pointIndex]?.timestamp : undefined;
}

/** Sample only the selected body's telemetry at the DOM clock cadence. */
export function useSelectedPlanet() {
  const displayTime = useDisplayTime();
  const { selection, master, base, parentMaster, parentBase, earthMaster, earthBase, viewMode } = useSolarStore(
    useShallow((state) => {
      const selection = state.selectedPlanet;
      const parentId = selection?.parentId;
      return {
        selection,
        master: selection ? state.masterTrajectorySegments[selection.bodyId] : undefined,
        base: selection ? state.baseTrajectorySegments[selection.bodyId] : undefined,
        parentMaster: parentId ? state.masterTrajectorySegments[parentId] : undefined,
        parentBase: parentId ? state.baseTrajectorySegments[parentId] : undefined,
        earthMaster: state.masterTrajectorySegments[BODY_IDS.EARTH],
        earthBase: state.baseTrajectorySegments[BODY_IDS.EARTH],
        viewMode: state.viewMode,
        // Explicit seeks update immediately, without subscribing to playback snapshots.
        timeSeekRevision: state.timeSeekRevision,
      };
    }),
  );

  // Read the live clock on selection/buffer changes too: displayTime may be up
  // to 500ms old when the user clicks a body or new data arrives.
  const timeMs = clockRuntime.isInitialized() ? clockRuntime.getTimeMs() : displayTime.getTime();
  if (!selection) return { planet: null, earthPosition: undefined };
  const bodySegments = selectSegmentsAtTime(master, base, timeMs);
  const parentSegments = selectSegmentsAtTime(parentMaster, parentBase, timeMs);
  const earthSegments = selectSegmentsAtTime(earthMaster, earthBase, timeMs);
  const sample = sampleTrajectoryStateAtTime(bodySegments, timeMs);
  const parent = sampleTrajectoryStateAtTime(parentSegments, timeMs);
  const earth = sampleTrajectoryStateAtTime(earthSegments, timeMs);
  const position = sample && (!selection.parentId || parent)
    ? {
      x: sample.position.x + (parent?.position.x ?? 0),
      y: sample.position.y + (parent?.position.y ?? 0),
      z: sample.position.z + (parent?.position.z ?? 0),
    }
    : undefined;
  const config = getPlanetConfig(selection.bodyId);
  const planet: SelectedPlanet = {
    ...selection,
    position,
    // Moon trajectories and their orbital velocities are parent-relative.
    velocity: sample?.velocity,
    radius: getRadius(selection.bodyId, config?.bodyClass ?? 'ROCKY_PLANET', viewMode),
    distanceFromSun: position ? Math.hypot(position.x, position.y, position.z) * KM_TO_UNIT : undefined,
    distanceToParentKm: selection.parentId && sample
      ? Math.hypot(sample.position.x, sample.position.y, sample.position.z) : undefined,
  };

  const staleSampleAt = (!sample ? getHeldTimestamp(bodySegments, timeMs) : undefined)
    ?? (!parent ? getHeldTimestamp(parentSegments, timeMs) : undefined);
  const isBarycentric = !!position && (sample?.referenceCenter === 'system_barycenter'
    || parent?.referenceCenter === 'system_barycenter');
  return { planet, earthPosition: earth?.position, staleSampleAt, isBarycentric };
}
