import { create } from 'zustand';
import type { SelectedPlanet, EphemerisData, EphemerisTrajectory } from '@/lib/types';
import type { ViewMode } from '@/lib/scales';
import {
  type TrajectorySegment,
  flattenTrajectorySegments,
  upsertTrajectorySegments,
} from '@/lib/trajectoryEngine';
import { 
  ClockState, 
  DEFAULT_CLOCK_RANGE, 
  TimeAuthority as ClockAuthority 
} from '@/lib/time/clockTypes';
import { 
  setClockTime, 
  applyMultiplier, 
  setPlaying, 
  setAuthority,
  stepClock
} from '@/lib/time/clockEngine';
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
  // Clock Domain (New)
  clock: ClockState;

  // Derived/Legacy Time State (Maintained for compatibility)
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
  
  // Actions
  setTimeAuthority: (auth: TimeAuthority) => void;
  setCurrentDate: (date: string) => void;
  setCurrentTime: (time: Date) => void;
  stepCurrentTimeByMs: (deltaMs: number) => void;
  syncTimeFromRuntime: (runtimeTimeMs: number) => void;
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

function parseUTCDate(date: string, fallbackMs = 0): Date {
  const utcDate = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(utcDate.getTime()) ? new Date(fallbackMs) : utcDate;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FORWARD_REBASE_DAYS = 25;
const BACKWARD_REBASE_DAYS = 5;
const MAX_SEGMENTS_PER_BODY = 3;

/**
 * Core temporal logic bridge.
 * Maps the ClockState engine output to the SolarStore public state.
 */
function syncClockToStore(state: Pick<SolarState, 'clock' | 'trajectoryBaseDate'>, nextClock: ClockState) {
  const nextTime = new Date(nextClock.currentTimeMs);
  const nextDate = toUTCDateString(nextTime);
  
  const currentBaseTime = parseUTCDate(state.trajectoryBaseDate).getTime();
  const diffDays = (nextClock.currentTimeMs - currentBaseTime) / DAY_MS;
  const shouldRebase = diffDays < -BACKWARD_REBASE_DAYS || diffDays > FORWARD_REBASE_DAYS;

  return {
    clock: nextClock,
    currentTime: nextTime,
    currentDate: nextDate,
    trajectoryBaseDate: shouldRebase ? nextDate : state.trajectoryBaseDate,
    timeAuthority: nextClock.authority,
    timeMultiplier: nextClock.multiplier,
    isPlaying: nextClock.isPlaying,
  };
}

export const useSolarStore = create<SolarState>((set) => ({
  clock: {
    currentTimeMs: Date.now(),
    multiplier: 60,
    isPlaying: false,
    authority: 'user',
    range: DEFAULT_CLOCK_RANGE,
    lastTickMs: Date.now(),
  },
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

  setTimeAuthority: (auth) => set((state) => 
    syncClockToStore(state, setAuthority(state.clock, auth))
  ),

  setCurrentDate: (date) => set((state) => {
    const newTimeMs = parseUTCDate(date, state.clock.currentTimeMs).getTime();
    clockRuntime.setTimeMs(newTimeMs);
    return syncClockToStore(state, setClockTime(state.clock, newTimeMs));
  }),

  setCurrentTime: (time) => set((state) => {
    const nextTimeMs = time.getTime();
    clockRuntime.setTimeMs(nextTimeMs);
    return syncClockToStore(state, setClockTime(state.clock, nextTimeMs));
  }),

  stepCurrentTimeByMs: (deltaMs) => set((state) => {
    const nextClock = stepClock(state.clock, { magnitude: deltaMs, unit: 'ms' });
    clockRuntime.setTimeMs(nextClock.currentTimeMs);
    return syncClockToStore(state, nextClock);
  }),

  syncTimeFromRuntime: (runtimeTimeMs) => set((state) => {
    if (!Number.isFinite(runtimeTimeMs)) {
      return state;
    }

    if (Math.abs(runtimeTimeMs - state.clock.currentTimeMs) <= 1) {
      return state;
    }

    return syncClockToStore(state, setClockTime(state.clock, runtimeTimeMs));
  }),

  setTimeMultiplier: (multiplier) => set((state) => 
    syncClockToStore(state, applyMultiplier(state.clock, multiplier))
  ),
  
  setIsPlaying: (playing) => set((state) => 
    syncClockToStore(state, setPlaying(state.clock, playing))
  ),

  advanceTime: (deltaSeconds) => set((state) => {
    if (!state.isPlaying || state.timeAuthority !== 'user') {
      return state;
    }

    const previousMs = state.clock.currentTimeMs;
    const nextRuntimeMs = clockRuntime.tick(deltaSeconds, state.timeMultiplier);
    if (!Number.isFinite(nextRuntimeMs) || Math.abs(nextRuntimeMs - previousMs) <= 1) {
      return state;
    }

    const expectedDeltaMs = deltaSeconds * state.clock.multiplier * 1000;
    const actualDeltaMs = nextRuntimeMs - previousMs;
    temporalMetrics.recordDrift(actualDeltaMs - expectedDeltaMs);
    return syncClockToStore(state, setClockTime(state.clock, nextRuntimeMs));
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

