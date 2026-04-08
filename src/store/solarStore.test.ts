import { describe, it, expect, beforeEach } from 'vitest';
import { useSolarStore } from './solarStore';
import type { EphemerisData, EphemerisTrajectory } from '@/lib/types';
import { clockRuntime } from '@/lib/time/clockRuntime';

function makeTrajectory(startIso: string, points: number, stepHours = 6): EphemerisTrajectory[] {
  const startMs = new Date(startIso).getTime();
  return Array.from({ length: points }, (_, index) => {
    const t = new Date(startMs + index * stepHours * 60 * 60 * 1000).toISOString();
    return {
      timestamp: t,
      position: { x: index, y: index * 2, z: index * 3 },
      velocity: { x: 0.01, y: 0.02, z: 0.03 },
    };
  });
}

function bodyPayload(bodyId: string, trajectory: EphemerisTrajectory[]): EphemerisData[] {
  return [
    {
      bodyId,
      name: bodyId,
      timestamp: trajectory[0].timestamp,
      position: trajectory[0].position,
      velocity: trajectory[0].velocity,
      trajectory,
    },
  ];
}

/**
 * Helper to set store state while keeping the new clock domain in sync.
 */
function setTestState(overrides: Partial<ReturnType<typeof useSolarStore.getState>>) {
  const currentState = useSolarStore.getState();
  const nextState = { ...currentState, ...overrides };
  
  // If we set legacy props, ensure clock is updated too
  if (overrides.currentTime || overrides.isPlaying !== undefined || overrides.timeAuthority || overrides.timeMultiplier !== undefined) {
    nextState.clock = {
      ...currentState.clock,
      currentTimeMs: (overrides.currentTime || currentState.currentTime).getTime(),
      isPlaying: overrides.isPlaying !== undefined ? overrides.isPlaying : currentState.isPlaying,
      authority: overrides.timeAuthority || currentState.timeAuthority,
      multiplier: overrides.timeMultiplier !== undefined ? overrides.timeMultiplier : currentState.timeMultiplier,
    };
  }
  
  useSolarStore.setState(nextState);
  clockRuntime.setTimeMs(nextState.currentTime.getTime());
}

describe('useSolarStore', () => {
  beforeEach(() => {
    setTestState({
      currentDate: '2026-03-26',
      trajectoryBaseDate: '2026-03-26',
      currentTime: new Date('2026-03-26T00:00:00Z'),
      timeAuthority: 'user',
      timeMultiplier: 1,
      isPlaying: false,
      selectedPlanet: null,
      hoveredPlanetId: null,
      viewMode: 'didactic',
      travelTarget: null,
      travelTargetRadius: undefined,
      masterTrajectory: {},
      masterTrajectorySegments: {},
      fullOrbits: {},
    });
  });

  it('should initialize with today date', () => {
    const state = useSolarStore.getState();
    expect(state.currentDate).toBeDefined();
    expect(state.trajectoryBaseDate).toBeDefined();
  });

  it('should update currentDate and currentTime correctly', () => {
    const { setCurrentDate } = useSolarStore.getState();
    
    setCurrentDate('2026-04-01');
    
    const state = useSolarStore.getState();
    expect(state.currentDate).toBe('2026-04-01');
    expect(state.currentTime.getUTCFullYear()).toBe(2026);
    expect(state.currentTime.getUTCMonth()).toBe(3); // April is 3
    expect(state.currentTime.getUTCDate()).toBe(1);
  });

  it('should NOT update trajectoryBaseDate if moving forward within 25 days', () => {
    const { setCurrentDate } = useSolarStore.getState();
    
    setCurrentDate('2026-04-10'); // +15 days
    
    const state = useSolarStore.getState();
    expect(state.currentDate).toBe('2026-04-10');
    expect(state.trajectoryBaseDate).toBe('2026-03-26');
  });

  it('should update trajectoryBaseDate if moving forward more than 25 days', () => {
    const { setCurrentDate } = useSolarStore.getState();
    
    setCurrentDate('2026-05-01'); // +36 days
    
    const state = useSolarStore.getState();
    expect(state.currentDate).toBe('2026-05-01');
    expect(state.trajectoryBaseDate).toBe('2026-05-01');
  });

  it('should update trajectoryBaseDate if moving backward', () => {
    const { setCurrentDate } = useSolarStore.getState();
    
    setCurrentDate('2026-03-20'); // -6 days
    
    const state = useSolarStore.getState();
    expect(state.currentDate).toBe('2026-03-20');
    expect(state.trajectoryBaseDate).toBe('2026-03-20');
  });

  it('should set currentTime to UTC midnight regardless of timezone', () => {
    const { setCurrentDate } = useSolarStore.getState();
    
    setCurrentDate('2026-03-26');
    
    const state = useSolarStore.getState();
    // In UTC, hours should be 0
    expect(state.currentTime.getUTCHours()).toBe(0);
  });

  it('should rebase trajectoryBaseDate when setCurrentTime moves beyond the forward window', () => {
    useSolarStore.getState().setCurrentTime(new Date('2026-05-01T12:00:00.000Z'));

    const state = useSolarStore.getState();
    expect(state.currentDate).toBe('2026-05-01');
    expect(state.trajectoryBaseDate).toBe('2026-05-01');
  });

  it('should not advance time while mission live authority is active', () => {
    setTestState({
      currentTime: new Date('2026-03-26T00:00:00.000Z'),
      currentDate: '2026-03-26',
      isPlaying: true,
      timeAuthority: 'mission_live',
      timeMultiplier: 60,
    });

    useSolarStore.getState().advanceTime(1);

    const state = useSolarStore.getState();
    expect(state.currentTime.toISOString()).toBe('2026-03-26T00:00:00.000Z');
    expect(state.currentDate).toBe('2026-03-26');
  });

  it('should advance time using seconds simulated per real second', () => {
    setTestState({
      currentTime: new Date('2026-03-26T00:00:00.000Z'),
      currentDate: '2026-03-26',
      isPlaying: true,
      timeAuthority: 'user',
      timeMultiplier: 60,
    });

    useSolarStore.getState().advanceTime(2);

    const state = useSolarStore.getState();
    expect(state.currentTime.toISOString()).toBe('2026-03-26T00:02:00.000Z');
    expect(state.currentDate).toBe('2026-03-26');
  });

  it('should keep at most 3 trajectory segments per body', () => {
    const { appendTrajectoryData } = useSolarStore.getState();

    appendTrajectoryData(bodyPayload('399', makeTrajectory('2026-01-01T00:00:00.000Z', 4)));
    appendTrajectoryData(bodyPayload('399', makeTrajectory('2026-02-01T00:00:00.000Z', 4)));
    appendTrajectoryData(bodyPayload('399', makeTrajectory('2026-03-01T00:00:00.000Z', 4)));
    appendTrajectoryData(bodyPayload('399', makeTrajectory('2026-04-01T00:00:00.000Z', 4)));

    const state = useSolarStore.getState();
    expect(state.masterTrajectorySegments['399']).toHaveLength(3);
  });

  it('should merge contiguous blocks into a single segment', () => {
    const { appendTrajectoryData } = useSolarStore.getState();

    appendTrajectoryData(bodyPayload('399', makeTrajectory('2026-01-01T00:00:00.000Z', 4)));
    // Contiguous continuation (+6h from previous endpoint)
    appendTrajectoryData(bodyPayload('399', makeTrajectory('2026-01-02T00:00:00.000Z', 4)));

    const state = useSolarStore.getState();
    expect(state.masterTrajectorySegments['399']).toHaveLength(1);
    expect(state.masterTrajectory['399'].length).toBeGreaterThan(4);
  });

  it('clearTrajectoryBuffer should clear both flattened and segmented pools', () => {
    const { appendTrajectoryData, clearTrajectoryBuffer } = useSolarStore.getState();

    appendTrajectoryData(bodyPayload('399', makeTrajectory('2026-01-01T00:00:00.000Z', 4)));
    clearTrajectoryBuffer();

    const state = useSolarStore.getState();
    expect(state.masterTrajectory['399']).toBeUndefined();
    expect(state.masterTrajectorySegments['399']).toBeUndefined();
  });

  // --- Phase 6: Temporal model correctness ---

  it('advanceTime does nothing when isPlaying is false', () => {
    setTestState({
      currentTime: new Date('2026-03-26T00:00:00.000Z'),
      currentDate: '2026-03-26',
      isPlaying: false,
      timeAuthority: 'user',
      timeMultiplier: 60,
    });

    useSolarStore.getState().advanceTime(10);

    const state = useSolarStore.getState();
    expect(state.currentTime.toISOString()).toBe('2026-03-26T00:00:00.000Z');
  });

  it('advanceTime uses millisecond arithmetic: deltaSeconds * timeMultiplier * 1000', () => {
    setTestState({
      currentTime: new Date('2026-03-26T00:00:00.000Z'),
      currentDate: '2026-03-26',
      isPlaying: true,
      timeAuthority: 'user',
      timeMultiplier: 3600, // 1 h/s
    });

    useSolarStore.getState().advanceTime(0.5); // 0.5 real seconds = 30 min simulated

    const state = useSolarStore.getState();
    // 0.5 * 3600 * 1000 = 1_800_000 ms = 30 min
    expect(state.currentTime.toISOString()).toBe('2026-03-26T00:30:00.000Z');
  });

  it('stepCurrentTimeByMs uses millisecond arithmetic', () => {
    setTestState({
      currentTime: new Date('2026-03-26T12:00:00.000Z'),
      currentDate: '2026-03-26',
      trajectoryBaseDate: '2026-03-26',
    });

    useSolarStore.getState().stepCurrentTimeByMs(-900_000); // -15 min

    const state = useSolarStore.getState();
    expect(state.currentTime.toISOString()).toBe('2026-03-26T11:45:00.000Z');
    expect(state.currentDate).toBe('2026-03-26');
  });

  it('setCurrentTime triggers rebase when jumping forward more than 25 days', () => {
    setTestState({
      currentTime: new Date('2026-03-26T00:00:00.000Z'),
      currentDate: '2026-03-26',
      trajectoryBaseDate: '2026-03-26',
    });

    useSolarStore.getState().setCurrentTime(new Date('2026-05-15T00:00:00.000Z'));

    const state = useSolarStore.getState();
    expect(state.trajectoryBaseDate).toBe('2026-05-15');
  });

  it('stepCurrentTimeByMs triggers rebase consistently with setCurrentTime', () => {
    setTestState({
      currentTime: new Date('2026-03-26T00:00:00.000Z'),
      currentDate: '2026-03-26',
      trajectoryBaseDate: '2026-03-26',
    });

    // Step forward 30 days in one big jump
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    useSolarStore.getState().stepCurrentTimeByMs(thirtyDaysMs);

    const state = useSolarStore.getState();
    // Should have rebased because 30d > FORWARD_REBASE_DAYS (25)
    expect(state.trajectoryBaseDate).toBe('2026-04-25');
  });

  it('currentDate is always derived from currentTime (UTC)', () => {
    setTestState({
      currentTime: new Date('2026-03-26T23:59:59.000Z'),
      currentDate: '2026-03-26',
      trajectoryBaseDate: '2026-03-26',
    });

    // Step forward 2 seconds — crosses midnight UTC
    useSolarStore.getState().stepCurrentTimeByMs(2000);

    const state = useSolarStore.getState();
    expect(state.currentTime.toISOString()).toBe('2026-03-27T00:00:01.000Z');
    expect(state.currentDate).toBe('2026-03-27');
  });

  it('timeAuthority transition to user allows playback', () => {
    setTestState({
      currentTime: new Date('2026-03-26T00:00:00.000Z'),
      currentDate: '2026-03-26',
      isPlaying: true,
      timeAuthority: 'mission_live',
      timeMultiplier: 60,
    });

    useSolarStore.getState().advanceTime(1);
    let state = useSolarStore.getState();
    // Still blocked by mission_live
    expect(state.currentTime.toISOString()).toBe('2026-03-26T00:00:00.000Z');

    // Transition to user authority
    useSolarStore.getState().setTimeAuthority('user');
    useSolarStore.getState().advanceTime(1);
    state = useSolarStore.getState();
    // Now advances by 1 * 60 * 1000 ms = 1 min
    expect(state.currentTime.toISOString()).toBe('2026-03-26T00:01:00.000Z');
  });
});
