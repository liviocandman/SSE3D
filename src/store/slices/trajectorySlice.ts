import { StateCreator } from 'zustand';
import type { EphemerisData, EphemerisTrajectory, OrbitLineData } from '@/lib/types';
import {
  type TrajectorySegment,
  flattenTrajectorySegments,
  upsertTrajectorySegments,
} from '@/lib/trajectoryEngine';
import { TimeSlice } from './timeSlice';

export interface TrajectoryState {
  // Master Buffer: Maps bodyId -> Sliding window of high-precision NASA vectors
  masterTrajectory: Record<string, EphemerisTrajectory[]>;
  masterTrajectorySegments: Record<string, TrajectorySegment[]>;
  
  // Full Cycle Buffer: Maps bodyId -> 100% of orbital period
  fullOrbits: Record<string, EphemerisTrajectory[]>;
  orbitLines: Record<string, OrbitLineData>;
}

export interface TrajectoryActions {
  appendTrajectoryData: (data: EphemerisData[]) => void;
  appendFullOrbits: (data: EphemerisData[]) => void;
  clearTrajectoryBuffer: () => void;
}

export type TrajectorySlice = TrajectoryState & TrajectoryActions;

const MAX_SEGMENTS_PER_BODY = 3;

export const createTrajectorySlice: StateCreator<
  TimeSlice & TrajectorySlice,
  [],
  [],
  TrajectorySlice
> = (set) => ({
  masterTrajectory: {},
  masterTrajectorySegments: {},
  fullOrbits: {},
  orbitLines: {},

  appendTrajectoryData: (data) =>
    set((state) => {
      const mergedFlat = { ...state.masterTrajectory };
      const mergedSegments = { ...state.masterTrajectorySegments };

      data.forEach((body) => {
        if (!body.trajectory) return;

        const existingSegments = mergedSegments[body.bodyId] || [];
        const nextSegments = upsertTrajectorySegments(
          existingSegments,
          body.trajectory,
          state.currentTime.getTime(),
          MAX_SEGMENTS_PER_BODY
        );

        mergedSegments[body.bodyId] = nextSegments;
        mergedFlat[body.bodyId] = flattenTrajectorySegments(nextSegments);
      });

      return {
        masterTrajectory: mergedFlat,
        masterTrajectorySegments: mergedSegments,
      };
    }),

  appendFullOrbits: (data) =>
    set((state) => {
      const mergedOrbits = { ...state.fullOrbits };
      const mergedLines = { ...state.orbitLines };
      
      data.forEach((body) => {
        if (body.trajectory) {
          mergedOrbits[body.bodyId] = body.trajectory;
        }
        if (body.orbitLine) {
          mergedLines[body.bodyId] = body.orbitLine;
        }
      });
      return { 
        fullOrbits: mergedOrbits,
        orbitLines: mergedLines 
      };
    }),

  clearTrajectoryBuffer: () =>
    set(() => ({ masterTrajectory: {}, masterTrajectorySegments: {} })),
});
