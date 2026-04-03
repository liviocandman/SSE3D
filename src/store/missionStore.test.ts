import { describe, it, expect, beforeEach } from 'vitest';
import { useMissionStore } from './missionStore';
import { MissionMode, MissionPhase, MissionDataSource } from '@/lib/missionTypes';

describe('missionStore', () => {
  beforeEach(() => {
    // Reset state before each test
    useMissionStore.getState().resetMissionState();
  });

  it('should initialize with correct default state', () => {
    const state = useMissionStore.getState();
    expect(state.missionMode).toBe(MissionMode.LIVE);
    expect(state.selectedMissionTargetId).toBeNull();
    expect(state.missionState).toBeNull();
    expect(state.missionTrajectory).toBeNull();
    expect(state.missionEvents).toBeNull();
    expect(state.missionHealth).toBeNull();
    expect(state.liveTimestamp).toBeNull();
  });

  it('should update mission mode correctly', () => {
    useMissionStore.getState().setMissionMode(MissionMode.REPLAY);
    expect(useMissionStore.getState().missionMode).toBe(MissionMode.REPLAY);
  });

  it('should update mission state correctly', () => {
    const mockState = {
      missionId: 'artemis-2',
      vehicleId: 'orion',
      mode: MissionMode.LIVE,
      phase: MissionPhase.LAUNCH,
      source: MissionDataSource.AROW_LIVE,
      sourceTimestamp: '2026-04-01T12:00:00Z',
      stalenessSeconds: 0,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      distances: { earthKm: 0, moonKm: 0 },
      missionElapsedTime: '0-00:00:00',
    };

    useMissionStore.getState().setMissionState(mockState);
    expect(useMissionStore.getState().missionState).toEqual(mockState);
  });

  it('should reset mission state correctly', () => {
    useMissionStore.getState().setMissionMode(MissionMode.REPLAY);
    useMissionStore.getState().setLiveTimestamp('2026-04-01T12:00:00Z');
    
    useMissionStore.getState().resetMissionState();
    
    const state = useMissionStore.getState();
    expect(state.missionMode).toBe(MissionMode.LIVE);
    expect(state.liveTimestamp).toBeNull();
  });
});
