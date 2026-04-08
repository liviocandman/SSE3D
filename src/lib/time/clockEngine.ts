import { ClockState, ClockStep, ClockRange } from './clockTypes';

const UNIT_TO_MS = {
  ms: 1,
  sec: 1000,
  min: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

/**
 * Pure functions for clock logic.
 */

export function tickClock(state: ClockState, deltaSeconds: number): ClockState {
  if (!state.isPlaying || state.authority === 'mission_live') {
    return state;
  }

  const simDeltaMs = deltaSeconds * state.multiplier * 1000;
  if (!Number.isFinite(simDeltaMs) || simDeltaMs === 0) {
    return state;
  }

  const nextTimeMs = state.currentTimeMs + simDeltaMs;
  const constrainedTimeMs = applyRangeConstraints(nextTimeMs, state.range);
  if (constrainedTimeMs === state.currentTimeMs) {
    return state;
  }

  return {
    ...state,
    currentTimeMs: constrainedTimeMs,
  };
}

export function setClockTime(state: ClockState, timeMs: number): ClockState {
  return {
    ...state,
    currentTimeMs: applyRangeConstraints(timeMs, state.range),
  };
}

export function applyMultiplier(state: ClockState, multiplier: number): ClockState {
  return {
    ...state,
    multiplier,
  };
}

export function applyRange(state: ClockState, range: ClockRange): ClockState {
  return {
    ...state,
    range,
    currentTimeMs: applyRangeConstraints(state.currentTimeMs, range),
  };
}

export function stepClock(state: ClockState, step: ClockStep): ClockState {
  const deltaMs = step.magnitude * UNIT_TO_MS[step.unit];
  const nextTimeMs = state.currentTimeMs + deltaMs;

  return {
    ...state,
    currentTimeMs: applyRangeConstraints(nextTimeMs, state.range),
  };
}

export function togglePlay(state: ClockState): ClockState {
  return {
    ...state,
    isPlaying: !state.isPlaying,
  };
}

export function setPlaying(state: ClockState, isPlaying: boolean): ClockState {
  return {
    ...state,
    isPlaying,
  };
}

export function setAuthority(state: ClockState, authority: ClockState['authority']): ClockState {
  return {
    ...state,
    authority,
  };
}

/**
 * Internal helper to clamp or loop time based on range.
 */
function applyRangeConstraints(timeMs: number, range: ClockRange): number {
  if (range.mode === 'unbounded') return timeMs;
  if (range.startMs === undefined || range.endMs === undefined) return timeMs;

  if (range.mode === 'clamp') {
    return Math.max(range.startMs, Math.min(range.endMs, timeMs));
  }

  if (range.mode === 'loop') {
    const duration = range.endMs - range.startMs;
    if (duration <= 0) return timeMs;
    
    let normalized = (timeMs - range.startMs) % duration;
    if (normalized < 0) normalized += duration;
    return range.startMs + normalized;
  }

  return timeMs;
}
