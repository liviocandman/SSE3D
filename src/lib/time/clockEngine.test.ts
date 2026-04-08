import { describe, it, expect } from 'vitest';
import { tickClock, setClockTime, stepClock } from './clockEngine';
import { ClockState, DEFAULT_CLOCK_RANGE } from './clockTypes';

const INITIAL_STATE: ClockState = {
  currentTimeMs: 1000,
  multiplier: 1,
  isPlaying: true,
  authority: 'user',
  range: DEFAULT_CLOCK_RANGE,
  lastTickMs: Date.now(),
};

describe('clockEngine', () => {
  it('ticks forward correctly', () => {
    const next = tickClock(INITIAL_STATE, 1); // 1 real second
    expect(next.currentTimeMs).toBe(2000);
  });

  it('honors multiplier when ticking', () => {
    const state = { ...INITIAL_STATE, multiplier: 60 };
    const next = tickClock(state, 1);
    expect(next.currentTimeMs).toBe(61000);
  });

  it('does not tick when paused', () => {
    const state = { ...INITIAL_STATE, isPlaying: false };
    const next = tickClock(state, 1);
    expect(next.currentTimeMs).toBe(1000);
  });

  it('does not tick when authority is mission_live', () => {
    const state = { ...INITIAL_STATE, authority: 'mission_live' as const };
    const next = tickClock(state, 1);
    expect(next.currentTimeMs).toBe(1000);
  });

  it('sets time correctly', () => {
    const next = setClockTime(INITIAL_STATE, 5000);
    expect(next.currentTimeMs).toBe(5000);
  });

  it('steps forward correctly', () => {
    const next = stepClock(INITIAL_STATE, { magnitude: 1, unit: 'sec' });
    expect(next.currentTimeMs).toBe(2000);
  });

  it('steps backward correctly', () => {
    const next = stepClock(INITIAL_STATE, { magnitude: -1, unit: 'hour' });
    expect(next.currentTimeMs).toBe(1000 - 3600000);
  });

  describe('range constraints', () => {
    const rangeState: ClockState = {
      ...INITIAL_STATE,
      range: { startMs: 0, endMs: 10000, mode: 'clamp' },
    };

    it('clamps to upper bound', () => {
      const next = setClockTime(rangeState, 15000);
      expect(next.currentTimeMs).toBe(10000);
    });

    it('clamps to lower bound', () => {
      const next = setClockTime(rangeState, -5000);
      expect(next.currentTimeMs).toBe(0);
    });

    it('loops correctly', () => {
      const state = { ...rangeState, range: { ...rangeState.range, mode: 'loop' as const } };
      const next = setClockTime(state, 12000);
      expect(next.currentTimeMs).toBe(2000);
    });

    it('loops backward correctly', () => {
      const state = { ...rangeState, range: { ...rangeState.range, mode: 'loop' as const } };
      const next = setClockTime(state, -2000);
      expect(next.currentTimeMs).toBe(8000);
    });
  });
});
