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

export type TimeAuthority = 'user' | 'mission_live';

export type RenderOriginMode = 'global' | 'selected_body' | 'mission_vehicle' | 'custom';

export type CameraNavMode = 'idle' | 'travel' | 'follow';

interface SolarState {
  currentDate: string; // YYYY-MM-DD
  trajectoryBaseDate: string; // Date used by initial ephemeris query window
  currentTime: Date;
  timeAuthority: TimeAuthority;
  timeMultiplier: number; // Seconds simulated per real second (e.g. 60 = 1 min/s)
  isPlaying: boolean;
  selectedPlanet: SelectedPlanet | null;
  hoveredPlanetId: string | null;
  viewMode: ViewMode;
  travelTarget: TravelTarget | null;
  travelTargetRadius?: number;

  // Camera-relative rendering (V1 & V2 Core)
  renderOrigin: { x: number; y: number; z: number };
  renderOriginMode: RenderOriginMode;

  // Navigation V2 (Origin-Only Model)
  cameraNavMode: CameraNavMode;
  originStartKm: { x: number; y: number; z: number };
  originTargetKm: { x: number; y: number; z: number };
  travelStartMs: number;
  travelDurationMs: number;
  followTargetId: string | null;
  followLeadTimeMs: number;

  // Master Buffer: Maps bodyId -> Sliding window of high-precision NASA vectors
  // Ensures memory stays constant (max 90 days of data from 3x30d blocks)
  masterTrajectory: Record<string, EphemerisTrajectory[]>;
  masterTrajectorySegments: Record<string, TrajectorySegment[]>;
  
  // Full Cycle Buffer: Maps bodyId -> 100% of orbital period (approx 400-600 points)
  // These are static background lines that do not expire.
  fullOrbits: Record<string, EphemerisTrajectory[]>;
  
  // Actions
  setTimeAuthority: (auth: TimeAuthority) => void;
  setCurrentDate: (date: string) => void;
  setCurrentTime: (time: Date) => void;
  stepCurrentTimeByMs: (deltaMs: number) => void;
  setTimeMultiplier: (multiplier: number) => void;
  setIsPlaying: (playing: boolean) => void;
  advanceTime: (deltaSeconds: number) => void;
  setSelectedPlanet: (planet: SelectedPlanet | null) => void;
  setHoveredPlanetId: (id: string | null) => void;
  appendTrajectoryData: (data: EphemerisData[]) => void;
  appendFullOrbits: (data: EphemerisData[]) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  setTravelTarget: (target: TravelTarget | null, radius?: number) => void;
  resetTravel: () => void;
  clearTrajectoryBuffer: () => void;

  setRenderOrigin: (origin: { x: number; y: number; z: number }, mode?: RenderOriginMode) => void;
  resetRenderOrigin: () => void;

  // Navigation V2 Actions
  startOriginTravel: (
    targetKm: { x: number; y: number; z: number },
    durationMs: number,
    nowMs: number,
    followTargetId?: string | null
  ) => void;
  setFollowTarget: (targetId: string | null, leadTimeMs?: number) => void;
  setOriginTarget: (targetKm: { x: number; y: number; z: number }) => void;
  stopOriginNavigation: () => void;
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

function computeTemporalStateUpdate(
  state: Pick<SolarState, 'trajectoryBaseDate'>,
  nextTime: Date
) {
  const nextDate = toUTCDateString(nextTime);
  const currentBaseTime = parseUTCDate(state.trajectoryBaseDate).getTime();
  const diffDays = (nextTime.getTime() - currentBaseTime) / DAY_MS;
  const shouldRebase =
    diffDays < -BACKWARD_REBASE_DAYS || diffDays > FORWARD_REBASE_DAYS;

  return {
    currentTime: nextTime,
    currentDate: nextDate,
    trajectoryBaseDate: shouldRebase ? nextDate : state.trajectoryBaseDate,
  };
}

export const useSolarStore = create<SolarState>((set) => ({
  currentDate: getTodayString(),
  trajectoryBaseDate: getTodayString(),
  currentTime: new Date(),
  timeAuthority: 'user',
  timeMultiplier: 60,
  isPlaying: false,
  selectedPlanet: null,
  hoveredPlanetId: null,
  viewMode: 'didactic',
  travelTarget: null,
  travelTargetRadius: undefined,
  renderOrigin: { x: 0, y: 0, z: 0 },
  renderOriginMode: 'global',

  cameraNavMode: 'idle',
  originStartKm: { x: 0, y: 0, z: 0 },
  originTargetKm: { x: 0, y: 0, z: 0 },
  travelStartMs: 0,
  travelDurationMs: 0,
  followTargetId: null,
  followLeadTimeMs: 0,

  masterTrajectory: {},
  masterTrajectorySegments: {},
  fullOrbits: {},

  setTimeAuthority: (auth) => set({ timeAuthority: auth }),

  setCurrentDate: (date) =>
    set((state) => {
      const newTime = parseUTCDate(date);
      return {
        ...computeTemporalStateUpdate(state, newTime),
        currentDate: date,
      };
    }),

  setCurrentTime: (time) => 
    set((state) => computeTemporalStateUpdate(state, time)),

  stepCurrentTimeByMs: (deltaMs) =>
    set((state) => {
      const nextTime = new Date(state.currentTime.getTime() + deltaMs);
      return computeTemporalStateUpdate(state, nextTime);
    }),

  setTimeMultiplier: (multiplier) => set({ timeMultiplier: multiplier }),
  
  setIsPlaying: (playing) => set({ isPlaying: playing }),

  advanceTime: (deltaSeconds) =>
    set((state) => {
      if (!state.isPlaying || state.timeAuthority === 'mission_live') return state;
      
      const simDeltaMs = deltaSeconds * state.timeMultiplier * 1000;
      const newTime = new Date(state.currentTime.getTime() + simDeltaMs);
      return computeTemporalStateUpdate(state, newTime);
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
  setHoveredPlanetId: (id) => set(() => ({ hoveredPlanetId: id })),
  setViewMode: (mode) => set(() => ({ viewMode: mode })),
  toggleViewMode: () =>
    set((state) => ({ viewMode: state.viewMode === 'didactic' ? 'realistic' : 'didactic' })),
  setTravelTarget: (target, radius) =>
    set(() => ({ travelTarget: target, travelTargetRadius: radius })),
  resetTravel: () => set(() => ({ travelTarget: null, travelTargetRadius: undefined })),
  clearTrajectoryBuffer: () =>
    set(() => ({ masterTrajectory: {}, masterTrajectorySegments: {} })),
  setRenderOrigin: (origin, mode = 'custom') =>
    set(() => ({ renderOrigin: origin, renderOriginMode: mode })),
  resetRenderOrigin: () =>
    set(() => ({ renderOrigin: { x: 0, y: 0, z: 0 }, renderOriginMode: 'global' })),

  startOriginTravel: (targetKm, durationMs, nowMs, followTargetId = null) => set((state) => ({
    cameraNavMode: 'travel',
    originStartKm: { ...state.renderOrigin },
    originTargetKm: targetKm,
    travelStartMs: nowMs,
    travelDurationMs: durationMs,
    followTargetId
  })),
  setFollowTarget: (targetId, leadTimeMs = 0) => set({
    cameraNavMode: 'follow',
    followTargetId: targetId,
    followLeadTimeMs: leadTimeMs
  }),
  setOriginTarget: (targetKm) => set({
    originTargetKm: targetKm
  }),
  stopOriginNavigation: () => set({
    cameraNavMode: 'idle',
    followTargetId: null
  }),
}));
