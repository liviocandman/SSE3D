export type TimeAuthority = 'user' | 'mission_live';

export interface ClockRange {
  startMs?: number;
  endMs?: number;
  mode: 'clamp' | 'loop' | 'unbounded';
}

export interface ClockState {
  currentTimeMs: number;
  multiplier: number;
  isPlaying: boolean;
  authority: TimeAuthority;
  range: ClockRange;
  lastTickMs: number;
}

export interface ClockStep {
  magnitude: number;
  unit: 'ms' | 'sec' | 'min' | 'hour' | 'day';
}

export const DEFAULT_CLOCK_RANGE: ClockRange = {
  mode: 'unbounded',
};

export const INITIAL_CLOCK_STATE: ClockState = {
  currentTimeMs: Date.now(),
  multiplier: 1,
  isPlaying: false,
  authority: 'user',
  range: DEFAULT_CLOCK_RANGE,
  lastTickMs: Date.now(),
};
