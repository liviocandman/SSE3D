import { describe, it, expect, beforeEach } from 'vitest';
import { useSolarStore } from './solarStore';
import type { EphemerisData, EphemerisTrajectory } from '@/lib/types';
import { clockRuntime } from '@/lib/time/clockRuntime';
import { hasCoverageAtTime, sampleTrajectoryAtTime } from '@/lib/trajectoryEngine';

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
 * Helper to set store state while keeping runtime snapshot in sync.
 */
function setTestState(overrides: Partial<ReturnType<typeof useSolarStore.getState>>) {
  const currentState = useSolarStore.getState();
  const nextState = { ...currentState, ...overrides };
  useSolarStore.setState(nextState);
  clockRuntime.setTimeMs(nextState.currentTime.getTime());
}

describe('useSolarStore', () => {
  beforeEach(() => {
    setTestState({
      currentDate: '2026-03-26',
      timeSeekRevision: 0,
      trajectoryBaseDate: '2026-03-26',
      currentTime: new Date('2026-03-26T00:00:00Z'),
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
      orbitLines: {},
      fullOrbitStatus: {},
      fullOrbitRetryAt: {},
      orbitLineStatus: {},
      orbitLineRetryAt: {},
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

  it('should advance time using seconds simulated per real second', () => {
    setTestState({
      currentTime: new Date('2026-03-26T00:00:00.000Z'),
      currentDate: '2026-03-26',
      isPlaying: true,
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

  it('preserves missing rapid-moon samples and fills the gap only with new scientific data', () => {
    const start = Date.parse('2026-03-26T00:00:00Z');
    const points = [0, 5, 10, 15, 20, 25, 30].map((minutes) => ({
      timestamp: new Date(start + minutes * 60_000).toISOString(),
      position: { x: minutes, y: 0, z: 0 },
    }));
    const state = useSolarStore.getState();
    state.appendTrajectoryData(bodyPayload('401', points.filter((_, index) => index !== 3)));
    const segments = useSolarStore.getState().masterTrajectorySegments['401'];
    expect(segments).toHaveLength(2);
    expect(hasCoverageAtTime(segments, start + 15 * 60_000)).toBe(false);
    expect(sampleTrajectoryAtTime(segments, start + 15 * 60_000)?.status).toBe('gap');
    state.appendTrajectoryData(bodyPayload('401', points.slice(2, 5)));
    expect(useSolarStore.getState().masterTrajectorySegments['401']).toHaveLength(1);
    expect(hasCoverageAtTime(useSolarStore.getState().masterTrajectorySegments['401'], start + 15 * 60_000)).toBe(true);
  });

  it('clearTrajectoryBuffer should clear both flattened and segmented pools', () => {
    const { appendTrajectoryData, clearTrajectoryBuffer } = useSolarStore.getState();

    appendTrajectoryData(bodyPayload('399', makeTrajectory('2026-01-01T00:00:00.000Z', 4)));
    clearTrajectoryBuffer();

    const state = useSolarStore.getState();
    expect(state.masterTrajectory['399']).toBeUndefined();
    expect(state.masterTrajectorySegments['399']).toBeUndefined();
  });

  it('does not notify subscribers for empty or fallback-only trajectory payloads', () => {
    const before = useSolarStore.getState();
    before.appendTrajectoryData([]);
    before.appendTrajectoryData([{ bodyId: '399', name: 'Earth', timestamp: '2026-03-26', position: { x: 0, y: 0, z: 0 }, trajectory: [] }]);
    before.appendFullOrbits([]);
    before.appendFullOrbits([{ bodyId: '399', name: 'Earth', timestamp: '2026-03-26', position: { x: 0, y: 0, z: 0 } }]);
    expect(useSolarStore.getState()).toBe(before);
  });

  it('keeps orbit-line recovery independent and avoids redundant status updates', () => {
    const initial = useSolarStore.getState();
    initial.setOrbitLineStatus(['501'], 'retryable_error', 1234);
    const retrying = useSolarStore.getState();
    expect(retrying.fullOrbitStatus).toBe(initial.fullOrbitStatus);
    expect(retrying.fullOrbitRetryAt).toBe(initial.fullOrbitRetryAt);
    retrying.setOrbitLineStatus(['501'], 'retryable_error', 1234);
    expect(useSolarStore.getState()).toBe(retrying);
    retrying.setOrbitLineStatus(['501'], 'ready');
    expect(useSolarStore.getState().orbitLineRetryAt['501']).toBeUndefined();
    expect(useSolarStore.getState().orbitLineStatus['501']).toBe('ready');
  });

  it('preserves full-orbit references for identical data and ignores empty replacements', () => {
    const payload = bodyPayload('399', makeTrajectory('2026-03-26', 4));
    useSolarStore.getState().appendFullOrbits(payload);
    const before = useSolarStore.getState();
    before.appendFullOrbits(JSON.parse(JSON.stringify(payload)));
    before.appendFullOrbits([{ ...payload[0], trajectory: [] }]);
    expect(useSolarStore.getState()).toBe(before);
  });

  it('preserves orbit-line references for repeated responses', () => {
    const payload = bodyPayload('301', makeTrajectory('2026-03-26', 4)).map((body) => ({
      ...body,
      orbitLine: {
        points: body.trajectory!.map((point) => ({ ...point.position, timestamp: point.timestamp })),
        isClosed: true, profile: 'regular' as const, algorithmVersion: 'test',
        sourceWindowStart: '2026-03-26', sourceWindowEnd: '2026-03-27',
        inputPointCount: 4, outputPointCount: 4, qualityFlags: [],
      },
    }));
    useSolarStore.getState().appendFullOrbits(payload);
    const before = useSolarStore.getState();
    before.appendFullOrbits(JSON.parse(JSON.stringify(payload)));
    expect(useSolarStore.getState()).toBe(before);
  });

  // --- Phase 6: Temporal model correctness ---

  it('advanceTime does nothing when isPlaying is false', () => {
    setTestState({
      currentTime: new Date('2026-03-26T00:00:00.000Z'),
      currentDate: '2026-03-26',
      isPlaying: false,
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

});

describe('explicit time seek revision', () => {
  beforeEach(() => {
    setTestState({
      currentDate: '2026-04-15', trajectoryBaseDate: '2026-04-15',
      currentTime: new Date('2026-04-15T12:00:00Z'), timeSeekRevision: 0,
      isPlaying: true, timeMultiplier: 86400,
    });
  });
  it('does not invalidate requests on playback, snapshot sync or automatic rebase', () => {
    useSolarStore.getState().advanceTime(1);
    expect(useSolarStore.getState().currentDate).toBe('2026-04-16');
    expect(useSolarStore.getState().timeSeekRevision).toBe(0);
    useSolarStore.getState().tickSimulation(30);
    useSolarStore.getState().syncTimeFromRuntime(clockRuntime.getTimeMs());
    expect(useSolarStore.getState().trajectoryBaseDate).toBe('2026-05-16');
    expect(useSolarStore.getState().timeSeekRevision).toBe(0);
  });
  it('invalidates requests for all explicit time actions, including same-day steps', () => {
    const state = useSolarStore.getState();
    const actions = [
      () => state.setCurrentDate('2026-04-16'),
      () => state.setCurrentTime(new Date('2026-04-16T01:00:00Z')),
      () => state.stepCurrentTimeByMs(60_000),
      () => state.stepByMsIntent(60_000),
      () => state.jumpToDateUtcIntent('2026-04-16'),
      () => state.resetToAnchorIntent(),
    ];
    actions.forEach((action, index) => {
      action();
      expect(useSolarStore.getState().timeSeekRevision).toBe(index + 1);
    });
  });
});
