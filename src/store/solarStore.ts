import { create } from 'zustand';
import type { SelectedPlanet, EphemerisData, EphemerisTrajectory } from '@/lib/types';
import type { ViewMode } from '@/lib/scales';
import {
  type TrajectorySegment,
  flattenTrajectorySegments,
  upsertTrajectorySegments,
} from '@/lib/trajectoryEngine';

interface TravelTarget {
  x: number;
  y: number;
  z: number;
}

interface SolarState {
  currentDate: string; // YYYY-MM-DD
  trajectoryBaseDate: string; // Date used by initial ephemeris query window
  currentTime: Date;
  timeMultiplier: number; // 1 = 1 day per real-world second (standard)
  isPlaying: boolean;
  selectedPlanet: SelectedPlanet | null;
  viewMode: ViewMode;
  travelTarget: TravelTarget | null;
  travelTargetRadius?: number;

  // Master Buffer: Maps bodyId -> Sliding window of high-precision NASA vectors
  // Ensures memory stays constant (max 90 days of data from 3x30d blocks)
  masterTrajectory: Record<string, EphemerisTrajectory[]>;
  masterTrajectorySegments: Record<string, TrajectorySegment[]>;
  
  // Full Cycle Buffer: Maps bodyId -> 100% of orbital period (approx 400-600 points)
  // These are static background lines that do not expire.
  fullOrbits: Record<string, EphemerisTrajectory[]>;
  
  // Actions
  setCurrentDate: (date: string) => void;
  setCurrentTime: (time: Date) => void;
  setTimeMultiplier: () => void;
  setIsPlaying: (playing: boolean) => void;
  advanceTime: (deltaSeconds: number) => void;
  setSelectedPlanet: (planet: SelectedPlanet | null) => void;
  appendTrajectoryData: (data: EphemerisData[]) => void;
  appendFullOrbits: (data: EphemerisData[]) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  setTravelTarget: (target: TravelTarget | null, radius?: number) => void;
  resetTravel: () => void;
  clearTrajectoryBuffer: () => void;
}

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

function toUTCDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

function parseUTCDate(date: string): Date {
  const utcDate = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(utcDate.getTime()) ? new Date() : utcDate;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FORWARD_REBASE_DAYS = 25;
const BACKWARD_REBASE_DAYS = 5;
const MAX_SEGMENTS_PER_BODY = 3;

export const useSolarStore = create<SolarState>((set) => ({
  currentDate: getTodayString(),
  trajectoryBaseDate: getTodayString(),
  currentTime: new Date(),
  timeMultiplier: 1.0,
  isPlaying: false,
  selectedPlanet: null,
  viewMode: 'didactic',
  travelTarget: null,
  travelTargetRadius: undefined,
  masterTrajectory: {},
  masterTrajectorySegments: {},
  fullOrbits: {},

  setCurrentDate: (date) =>
    set((state) => {
      const newTime = parseUTCDate(date);
      
      const currentBaseTime = parseUTCDate(state.trajectoryBaseDate).getTime();
      const targetTime = newTime.getTime();
      const diffDays = (targetTime - currentBaseTime) / DAY_MS;

      // Rebase only if we move far forward OR even slightly backward past a grace period.
      // This prevents hammering the API when scrubbing small amounts.
      const shouldRebase =
        diffDays < -BACKWARD_REBASE_DAYS || diffDays > FORWARD_REBASE_DAYS;

      return {
        currentDate: date, 
        currentTime: newTime,
        trajectoryBaseDate: shouldRebase ? date : state.trajectoryBaseDate,
      };
    }),

  setCurrentTime: (time) => 
    set(() => ({ 
      currentTime: time,
      currentDate: toUTCDateString(time),
    })),

  setTimeMultiplier: () => set({ timeMultiplier: 1.0 }),
  
  setIsPlaying: (playing) => set({ isPlaying: playing }),

  advanceTime: (deltaSeconds) =>
    set((state) => {
      if (!state.isPlaying) return state;
      
      const simDeltaMs = deltaSeconds * state.timeMultiplier * 24 * 60 * 60 * 1000;
      const newTime = new Date(state.currentTime.getTime() + simDeltaMs);
      const newDateStr = toUTCDateString(newTime);
      
      return {
        currentTime: newTime,
        currentDate: newDateStr !== state.currentDate ? newDateStr : state.currentDate
      };
    }),

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
      const merged = { ...state.fullOrbits };
      data.forEach((body) => {
        if (body.trajectory) {
          merged[body.bodyId] = body.trajectory;
        }
      });
      return { fullOrbits: merged };
    }),

  setSelectedPlanet: (planet) => set(() => ({ selectedPlanet: planet })),
  setViewMode: (mode) => set(() => ({ viewMode: mode })),
  toggleViewMode: () =>
    set((state) => ({ viewMode: state.viewMode === 'didactic' ? 'realistic' : 'didactic' })),
  setTravelTarget: (target, radius) =>
    set(() => ({ travelTarget: target, travelTargetRadius: radius })),
  resetTravel: () => set(() => ({ travelTarget: null, travelTargetRadius: undefined })),
  clearTrajectoryBuffer: () =>
    set(() => ({ masterTrajectory: {}, masterTrajectorySegments: {} })),
}));
