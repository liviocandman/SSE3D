import { describe, it, expect, beforeEach } from 'vitest';
import { useSolarStore } from './solarStore';
import type { EphemerisData, EphemerisTrajectory } from '@/lib/types';

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

describe('useSolarStore', () => {
  beforeEach(() => {
    useSolarStore.setState({
      currentDate: '2026-03-26',
      trajectoryBaseDate: '2026-03-26',
      currentTime: new Date(2026, 2, 26),
      timeMultiplier: 1,
      isPlaying: false,
      selectedPlanet: null,
      viewMode: 'didactic',
      travelTarget: null,
      travelTargetRadius: undefined,
      masterTrajectory: {},
      masterTrajectorySegments: {},
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
    expect(state.currentTime.getFullYear()).toBe(2026);
    expect(state.currentTime.getMonth()).toBe(3); // April is 3
    expect(state.currentTime.getDate()).toBe(1);
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

  it('should set currentTime to local midnight regardless of timezone', () => {
    const { setCurrentDate } = useSolarStore.getState();
    
    setCurrentDate('2026-03-26');
    
    const state = useSolarStore.getState();
    // In local time, hours should be 0
    expect(state.currentTime.getHours()).toBe(0);
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
});
