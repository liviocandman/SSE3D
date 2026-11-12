import { StateCreator } from 'zustand';
import type { EphemerisData, EphemerisTrajectory, OrbitLineData } from '@/lib/types';
import {
  type TrajectorySegment,
  flattenTrajectorySegments,
  upsertTrajectorySegments,
} from '@/lib/trajectoryEngine';
import { TimeSlice } from './timeSlice';

export type FullOrbitStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'retryable_error' | 'error';

export interface TrajectoryState {
  // Master Buffer: Maps bodyId -> Sliding window of high-precision NASA vectors
  masterTrajectory: Record<string, EphemerisTrajectory[]>;
  masterTrajectorySegments: Record<string, TrajectorySegment[]>;
  
  // Full Cycle Buffer: Maps bodyId -> 100% of orbital period
  fullOrbits: Record<string, EphemerisTrajectory[]>;
  orbitLines: Record<string, OrbitLineData>;
  fullOrbitStatus: Record<string, FullOrbitStatus>;
  fullOrbitRetryAt: Record<string, number>;
}

export interface TrajectoryActions {
  appendTrajectoryData: (data: EphemerisData[]) => void;
  appendFullOrbits: (data: EphemerisData[]) => void;
  clearTrajectoryBuffer: () => void;
  setFullOrbitStatus: (ids: string[], status: FullOrbitStatus, retryAt?: number) => void;
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
  fullOrbitStatus: {},
  fullOrbitRetryAt: {},

  setFullOrbitStatus: (ids, status, retryAt) => set((state) => {
    const nextRetryAt = status === 'retryable_error' ? retryAt : undefined;
    const changedIds = ids.filter((id) => state.fullOrbitStatus[id] !== status || state.fullOrbitRetryAt[id] !== nextRetryAt);
    if (changedIds.length === 0) return state;
    const fullOrbitStatus = { ...state.fullOrbitStatus };
    const fullOrbitRetryAt = { ...state.fullOrbitRetryAt };
    for (const id of changedIds) {
      fullOrbitStatus[id] = status;
      if (nextRetryAt === undefined) delete fullOrbitRetryAt[id];
      else fullOrbitRetryAt[id] = nextRetryAt;
    }
    return { fullOrbitStatus, fullOrbitRetryAt };
  }),

  appendTrajectoryData: (data) =>
    set((state) => {
      let mergedFlat = state.masterTrajectory;
      let mergedSegments = state.masterTrajectorySegments;

      data.forEach((body) => {
        if (!body.trajectory?.length) return;

        const existingSegments = mergedSegments[body.bodyId] || [];
        const nextSegments = upsertTrajectorySegments(
          existingSegments,
          body.trajectory,
          state.currentTime.getTime(),
          MAX_SEGMENTS_PER_BODY,
          undefined,
          body.bodyId,
        );

        if (nextSegments === existingSegments) return;
        if (mergedSegments === state.masterTrajectorySegments) {
          mergedSegments = { ...mergedSegments };
          mergedFlat = { ...mergedFlat };
        }
        mergedSegments[body.bodyId] = nextSegments;
        mergedFlat[body.bodyId] = flattenTrajectorySegments(nextSegments);
      });

      if (mergedSegments === state.masterTrajectorySegments) return state;
      return {
        masterTrajectory: mergedFlat,
        masterTrajectorySegments: mergedSegments,
      };
    }),

  appendFullOrbits: (data) =>
    set((state) => {
      let mergedOrbits = state.fullOrbits;
      let mergedLines = state.orbitLines;
      
      data.forEach((body) => {
        if (body.trajectory && body.trajectory.length >= 2 && !sameTrajectory(mergedOrbits[body.bodyId], body.trajectory)) {
          if (mergedOrbits === state.fullOrbits) mergedOrbits = { ...mergedOrbits };
          mergedOrbits[body.bodyId] = body.trajectory;
        }
        if (body.orbitLine && body.orbitLine.points.length >= 2 && !sameOrbitLine(mergedLines[body.bodyId], body.orbitLine)) {
          if (mergedLines === state.orbitLines) mergedLines = { ...mergedLines };
          mergedLines[body.bodyId] = body.orbitLine;
        }
      });
      if (mergedOrbits === state.fullOrbits && mergedLines === state.orbitLines) return state;
      return { 
        fullOrbits: mergedOrbits,
        orbitLines: mergedLines 
      };
    }),

  clearTrajectoryBuffer: () =>
    set(() => ({ masterTrajectory: {}, masterTrajectorySegments: {} })),
});

function sameTrajectory(a: EphemerisTrajectory[] | undefined, b: EphemerisTrajectory[]): boolean {
  if (a === b) return true;
  return a?.length === b.length && a.every((point, index) => {
    const other = b[index];
    return point.timestamp === other.timestamp &&
      point.position.x === other.position.x && point.position.y === other.position.y && point.position.z === other.position.z &&
      point.velocity?.x === other.velocity?.x && point.velocity?.y === other.velocity?.y && point.velocity?.z === other.velocity?.z;
  });
}

function sameOrbitLine(a: OrbitLineData | undefined, b: OrbitLineData): boolean {
  if (a === b) return true;
  if (!a || a.isClosed !== b.isClosed || a.profile !== b.profile ||
    a.algorithmVersion !== b.algorithmVersion || a.sourceWindowStart !== b.sourceWindowStart ||
    a.sourceWindowEnd !== b.sourceWindowEnd || a.inputPointCount !== b.inputPointCount ||
    a.outputPointCount !== b.outputPointCount || a.qualityFlags.length !== b.qualityFlags.length ||
    a.qualityFlags.some((flag, index) => flag !== b.qualityFlags[index])) return false;
  return a.points.length === b.points.length && a.points.every((point, index) => {
    const other = b.points[index];
    return point.timestamp === other.timestamp && point.x === other.x && point.y === other.y && point.z === other.z;
  });
}
