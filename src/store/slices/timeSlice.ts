import { StateCreator } from 'zustand';
import { clockRuntime } from '@/lib/time/clockRuntime';
import { temporalMetrics } from '@/lib/time/metrics';
import { TimeAuthority as ClockAuthority } from '@/lib/time/clockTypes';

export type TimeAuthority = ClockAuthority;

export interface TimeState {
  currentDate: string; // YYYY-MM-DD
  trajectoryBaseDate: string; // Date used by initial ephemeris query window
  currentTime: Date;
  timeAuthority: TimeAuthority;
  timeMultiplier: number; // Seconds simulated per real second (e.g. 60 = 1 min/s)
  isPlaying: boolean;
}

export interface TimeActions {
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
  advanceTime: (deltaSeconds: number) => void;
}

export type TimeSlice = TimeState & TimeActions;

// --- Helpers moved from solarStore.ts ---

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

/**
 * Syncs store snapshot fields from the authoritative runtime timestamp.
 */
function syncTimeSnapshot(
  state: Pick<TimeState, 'trajectoryBaseDate'>,
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

export const createTimeSlice: StateCreator<TimeSlice, [], [], TimeSlice> = (set, get) => ({
  currentDate: getTodayString(),
  trajectoryBaseDate: getTodayString(),
  currentTime: new Date(),
  timeAuthority: 'user',
  timeMultiplier: 60,
  isPlaying: false,

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
      if (!Number.isFinite(liveTimeMs)) return state as TimeSlice;
      clockRuntime.setTimeMs(liveTimeMs);
      return {
        ...syncTimeSnapshot(state, liveTimeMs),
        timeAuthority: 'mission_live',
        isPlaying: false,
      } as Partial<TimeSlice>;
    }),

  resetToAnchorIntent: (liveTimestamp) =>
    set((state) => {
      const anchor = liveTimestamp ? new Date(liveTimestamp) : new Date();
      const anchorMs = anchor.getTime();
      if (!Number.isFinite(anchorMs)) return state as TimeSlice;
      clockRuntime.setTimeMs(anchorMs);
      return {
        ...syncTimeSnapshot(state, anchorMs),
        timeAuthority: 'user',
        isPlaying: false,
      } as Partial<TimeSlice>;
    }),

  syncTimeFromRuntime: (runtimeTimeMs) => set((state) => {
    if (!Number.isFinite(runtimeTimeMs)) {
      return state as TimeSlice;
    }

    if (Math.abs(runtimeTimeMs - state.currentTime.getTime()) <= 1) {
      return state as TimeSlice;
    }

    return syncTimeSnapshot(state, runtimeTimeMs) as Partial<TimeSlice>;
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
      return state as TimeSlice;
    }

    const previousMs = clockRuntime.getTimeMs();
    const nextRuntimeMs = get().tickSimulation(deltaSeconds);
    if (!Number.isFinite(nextRuntimeMs) || Math.abs(nextRuntimeMs - previousMs) <= 1) {
      return state as TimeSlice;
    }

    const expectedDeltaMs = deltaSeconds * state.timeMultiplier * 1000;
    const actualDeltaMs = nextRuntimeMs - previousMs;
    temporalMetrics.recordDrift(actualDeltaMs - expectedDeltaMs);
    return syncTimeSnapshot(state, nextRuntimeMs) as Partial<TimeSlice>;
  }),
});
