import { create } from 'zustand';
import type { SelectedPlanet, EphemerisData, EphemerisTrajectory, OrbitLineData } from '@/lib/types';
import type { ViewMode } from '@/lib/scales';
import {
  type TrajectorySegment,
  flattenTrajectorySegments,
  upsertTrajectorySegments,
} from '@/lib/trajectoryEngine';
import { TimeAuthority as ClockAuthority } from '@/lib/time/clockTypes';
import { temporalMetrics } from '@/lib/time/metrics';
import { clockRuntime } from '@/lib/time/clockRuntime';

interface TravelTarget {
  x: number;
  y: number;
  z: number;
}

export type TimeAuthority = ClockAuthority;

export type RenderOriginMode = 'global' | 'selected_body' | 'mission_vehicle' | 'custom';

export type CameraNavMode = 'idle' | 'travel' | 'follow';

interface SolarState {
  // Time snapshot/UI state. Authoritative simulation time lives in clockRuntime.
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
  masterTrajectory: Record<string, EphemerisTrajectory[]>;
  masterTrajectorySegments: Record<string, TrajectorySegment[]>;
  
  // Full Cycle Buffer: Maps bodyId -> 100% of orbital period
  fullOrbits: Record<string, EphemerisTrajectory[]>;
  orbitLines: Record<string, OrbitLineData>;
  
  // Actions
  setTimeAuthority: (auth: TimeAuthority) => void;
  setCurrentDate: (date: string) => void;
  setCurrentTime: (time: Date) => void;
  stepCurrentTimeByMs: (deltaMs: number) => void;
  togglePlaybackIntent: () => void;
  stepByMsIntent: (deltaMs: number) => void;
  jumpToDateUtcIntent: (date: string) => void;
  goLiveIntent: (liveTimestamp: string) => void;
  resetToAnchorIntent: (liveTimestamp?: string) => void;
  syncTimeFromRuntime: (runtimeTimeMs: number) => void;
  ensureRuntimeInitialized: () => void;
  tickSimulation: (deltaSeconds: number) => number;
  setTimeMultiplier: (multiplier: number) => void;
  setIsPlaying: (playing: boolean) => void;
  // Compatibility action for tests/legacy callers; delegates to tickSimulation.
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

function parseUTCDate(date: string, fallbackMs = 0): Date {
  const utcDate = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(utcDate.getTime()) ? new Date(fallbackMs) : utcDate;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FORWARD_REBASE_DAYS = 25;
const BACKWARD_REBASE_DAYS = 5;
const MAX_SEGMENTS_PER_BODY = 3;

/**
 * Syncs store snapshot fields from the authoritative runtime timestamp.
 */
function syncTimeSnapshot(
  state: Pick<SolarState, 'trajectoryBaseDate'>,
  runtimeTimeMs: number,
) {
  const nextTime = new Date(runtimeTimeMs);
  const nextDate = toUTCDateString(nextTime);
  
  const currentBaseTime = parseUTCDate(state.trajectoryBaseDate).getTime();
  const diffDays = (runtimeTimeMs - currentBaseTime) / DAY_MS;
  const shouldRebase = diffDays < -BACKWARD_REBASE_DAYS || diffDays > FORWARD_REBASE_DAYS;

  return {
    currentTime: nextTime,
    currentDate: nextDate,
    trajectoryBaseDate: shouldRebase ? nextDate : state.trajectoryBaseDate,
  };
}

export const useSolarStore = create<SolarState>((set, get) => ({
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
  orbitLines: {},

  setTimeAuthority: (auth) => set(() => ({ timeAuthority: auth })),

  setCurrentDate: (date) => set((state) => {
    const newTimeMs = parseUTCDate(date, state.currentTime.getTime()).getTime();
    clockRuntime.setTimeMs(newTimeMs);
    return syncTimeSnapshot(state, newTimeMs);
  }),

  setCurrentTime: (time) => set((state) => {
    const nextTimeMs = time.getTime();
    clockRuntime.setTimeMs(nextTimeMs);
    return syncTimeSnapshot(state, nextTimeMs);
  }),

  stepCurrentTimeByMs: (deltaMs) => set((state) => {
    const nextRuntimeMs = clockRuntime.getTimeMs() + deltaMs;
    clockRuntime.setTimeMs(nextRuntimeMs);
    return syncTimeSnapshot(state, nextRuntimeMs);
  }),

  togglePlaybackIntent: () =>
    set((state) => ({
      timeAuthority: 'user',
      isPlaying: !state.isPlaying,
    })),

  stepByMsIntent: (deltaMs) =>
    set((state) => {
      const nextRuntimeMs = clockRuntime.getTimeMs() + deltaMs;
      clockRuntime.setTimeMs(nextRuntimeMs);
      return {
        ...syncTimeSnapshot(state, nextRuntimeMs),
        timeAuthority: 'user',
        isPlaying: false,
      };
    }),

  jumpToDateUtcIntent: (date) =>
    set((state) => {
      const nextTimeMs = parseUTCDate(date, state.currentTime.getTime()).getTime();
      clockRuntime.setTimeMs(nextTimeMs);
      return {
        ...syncTimeSnapshot(state, nextTimeMs),
        timeAuthority: 'user',
      };
    }),

  goLiveIntent: (liveTimestamp) =>
    set((state) => {
      const liveTime = new Date(liveTimestamp);
      const liveTimeMs = liveTime.getTime();
      if (!Number.isFinite(liveTimeMs)) return state;
      clockRuntime.setTimeMs(liveTimeMs);
      return {
        ...syncTimeSnapshot(state, liveTimeMs),
        timeAuthority: 'mission_live',
        isPlaying: false,
      };
    }),

  resetToAnchorIntent: (liveTimestamp) =>
    set((state) => {
      const anchor = liveTimestamp ? new Date(liveTimestamp) : new Date();
      const anchorMs = anchor.getTime();
      if (!Number.isFinite(anchorMs)) return state;
      clockRuntime.setTimeMs(anchorMs);
      return {
        ...syncTimeSnapshot(state, anchorMs),
        timeAuthority: 'user',
        isPlaying: false,
      };
    }),

  syncTimeFromRuntime: (runtimeTimeMs) => set((state) => {
    if (!Number.isFinite(runtimeTimeMs)) {
      return state;
    }

    if (Math.abs(runtimeTimeMs - state.currentTime.getTime()) <= 1) {
      return state;
    }

    return syncTimeSnapshot(state, runtimeTimeMs);
  }),

  ensureRuntimeInitialized: () => {
    if (clockRuntime.isInitialized()) return;
    const state = get();
    clockRuntime.initialize(state.currentTime.getTime());
  },

  tickSimulation: (deltaSeconds) => {
    const state = get();
    if (!state.isPlaying || state.timeAuthority !== 'user') {
      return clockRuntime.getTimeMs();
    }
    return clockRuntime.tick(deltaSeconds, state.timeMultiplier);
  },

  setTimeMultiplier: (multiplier) => set(() => ({ timeMultiplier: multiplier })),
  
  setIsPlaying: (playing) => set(() => ({ isPlaying: playing })),

  advanceTime: (deltaSeconds) => set((state) => {
    if (!state.isPlaying || state.timeAuthority !== 'user') {
      return state;
    }

    const previousMs = clockRuntime.getTimeMs();
    const nextRuntimeMs = get().tickSimulation(deltaSeconds);
    if (!Number.isFinite(nextRuntimeMs) || Math.abs(nextRuntimeMs - previousMs) <= 1) {
      return state;
    }

    const expectedDeltaMs = deltaSeconds * state.timeMultiplier * 1000;
    const actualDeltaMs = nextRuntimeMs - previousMs;
    temporalMetrics.recordDrift(actualDeltaMs - expectedDeltaMs);
    return syncTimeSnapshot(state, nextRuntimeMs);
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

