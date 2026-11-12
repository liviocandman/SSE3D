'use client';

import { useShallow } from 'zustand/react/shallow';
import { useSolarStore } from '@/store/solarStore';
import { useDisplayTime } from './useDisplayTime';
import { clockRuntime } from '@/lib/time/clockRuntime';
import { sampleTrajectoryStateAtTime } from '@/lib/trajectoryEngine';
import { BODY_IDS, type SelectedPlanet } from '@/lib/types';
import { getPlanetConfig } from '@/lib/textureConfig';
import { getRadius, KM_TO_UNIT } from '@/lib/scales';

/** Sample only the selected body's telemetry at the DOM clock cadence. */
export function useSelectedPlanet() {
  const displayTime = useDisplayTime();
  const { selection, segments, parentSegments, earthSegments, viewMode } = useSolarStore(
    useShallow((state) => ({
      selection: state.selectedPlanet,
      segments: state.selectedPlanet ? state.masterTrajectorySegments[state.selectedPlanet.bodyId] : undefined,
      parentSegments: state.selectedPlanet?.parentId
        ? state.masterTrajectorySegments[state.selectedPlanet.parentId] : undefined,
      earthSegments: state.masterTrajectorySegments[BODY_IDS.EARTH],
      viewMode: state.viewMode,
      // Explicit seeks update immediately, without subscribing to playback snapshots.
      timeSeekRevision: state.timeSeekRevision,
    })),
  );

  // Read the live clock on selection/buffer changes too: displayTime may be up
  // to 500ms old when the user clicks a body or new data arrives.
  const timeMs = clockRuntime.isInitialized() ? clockRuntime.getTimeMs() : displayTime.getTime();
  if (!selection) return { planet: null, earthPosition: undefined };

  const sample = segments ? sampleTrajectoryStateAtTime(segments, timeMs) : null;
  const parent = parentSegments ? sampleTrajectoryStateAtTime(parentSegments, timeMs) : null;
  const earth = earthSegments ? sampleTrajectoryStateAtTime(earthSegments, timeMs) : null;
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

  return { planet, earthPosition: earth?.position };
}
