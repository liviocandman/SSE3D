import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrajectoryManager } from './TrajectoryManager';
import { useSolarStore } from '@/store/solarStore';
import { clockRuntime } from '@/lib/time/clockRuntime';
import { BASELINE_PLANET_IDS } from '@/lib/trajectoryPolicy';
import { trajectoryRequestWindow } from '@/lib/trajectoryRequestWindow';
import { hasCoverageAtTime } from '@/lib/trajectoryEngine';
import type { EphemerisData } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  requestTrajectoryBlock: vi.fn(), requestOrbitLines: vi.fn(), frame: () => {},
}));
vi.unmock('zustand/react/shallow');
vi.mock('@react-three/fiber', () => ({ useFrame: (callback: () => void) => { mocks.frame = callback; } }));
vi.mock('@/contexts/QualityTierContext', () => ({ useQualityTier: () => ({ tier: 'high' }) }));
vi.mock('@/hooks/useTrajectoryClient', () => ({ useTrajectoryClient: () => mocks }));

type Request = { date: string; spanDays: number; ids: string[]; signal: AbortSignal };
function responseFor(request: Request): EphemerisData[] {
  return request.ids.map((bodyId) => {
    const window = trajectoryRequestWindow(bodyId, request.date, request.spanDays);
    const trajectory = Array.from({ length: 200 }, (_, index) => ({
      timestamp: new Date(window.startMs + index * (window.endMs - window.startMs) / 199).toISOString(),
      position: { x: index + 1, y: 0, z: 0 },
    }));
    return { bodyId, name: bodyId, timestamp: trajectory[0].timestamp, position: trajectory[0].position, trajectory };
  });
}
function advancePlayback(seconds: number) {
  const state = useSolarStore.getState();
  state.tickSimulation(seconds);
  state.syncTimeFromRuntime(clockRuntime.getTimeMs());
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.requestTrajectoryBlock.mockReset();
  mocks.requestOrbitLines.mockReset().mockResolvedValue([]);
  const currentTime = new Date('2026-04-15T12:00:00Z');
  clockRuntime.setTimeMs(currentTime.getTime());
  useSolarStore.setState({
    currentDate: '2026-04-15', trajectoryBaseDate: '2026-04-15', currentTime,
    timeSeekRevision: 0, timeMultiplier: 86400, isPlaying: true,
    selectedPlanet: null, hoveredPlanetId: null,
    masterTrajectory: {}, masterTrajectorySegments: {}, orbitLines: {},
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('TrajectoryManager request lifecycle', () => {
  it.each([1, -1])('keeps a two-second request useful across date changes in direction %i', async (direction) => {
    useSolarStore.setState({ timeMultiplier: direction * 86400 });
    mocks.requestTrajectoryBlock.mockImplementation((request: Request) => new Promise((resolve) => {
      setTimeout(() => resolve(responseFor(request)), 2000);
    }));
    renderHook(() => TrajectoryManager());
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const request: Request = mocks.requestTrajectoryBlock.mock.calls[0][0];
    for (let second = 0; second < 2; second++) {
      act(() => advancePlayback(1));
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(request.signal.aborted).toBe(false);
    }
    expect(mocks.requestTrajectoryBlock).toHaveBeenCalledOnce();
    expect(hasCoverageAtTime(useSolarStore.getState().masterTrajectorySegments['399'], clockRuntime.getTimeMs())).toBe(true);
    expect(useSolarStore.getState().timeSeekRevision).toBe(0);
  });

  it('keeps background prefetch alive as playback crosses UTC dates', async () => {
    const currentTime = new Date('2026-04-25T12:00:00Z');
    clockRuntime.setTimeMs(currentTime.getTime());
    useSolarStore.setState({ currentDate: '2026-04-25', currentTime });
    useSolarStore.getState().appendTrajectoryData(responseFor({
      ids: BASELINE_PLANET_IDS, date: '2026-05-01', spanDays: 30, signal: new AbortController().signal,
    }));
    let finish!: (data: EphemerisData[]) => void;
    mocks.requestTrajectoryBlock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderHook(() => TrajectoryManager());
    act(() => { for (let frame = 0; frame < 300; frame++) mocks.frame(); });
    const request: Request = mocks.requestTrajectoryBlock.mock.calls[0][0];
    const window = trajectoryRequestWindow('399', request.date, request.spanDays);
    expect(window.startMs).toBe(Date.parse('2026-05-01T00:00:00Z'));
    for (let second = 0; second < 2; second++) {
      act(() => advancePlayback(1));
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    }
    expect(request.signal.aborted).toBe(false);
    expect(mocks.requestTrajectoryBlock).toHaveBeenCalledOnce();
    await act(async () => finish(responseFor(request)));
    expect(useSolarStore.getState().masterTrajectorySegments['399'].at(-1)!.endTimeMs).toBe(window.endMs);
  });

  it('cancels explicit same-day seeks and rejects late results from the old request', async () => {
    const finishes: ((data: EphemerisData[]) => void)[] = [];
    mocks.requestTrajectoryBlock.mockImplementation(() => new Promise((resolve) => { finishes.push(resolve); }));
    renderHook(() => TrajectoryManager());
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const previous: Request = mocks.requestTrajectoryBlock.mock.calls[0][0];
    act(() => useSolarStore.getState().stepByMsIntent(2 * 3_600_000));
    expect(useSolarStore.getState().currentDate).toBe('2026-04-15');
    expect(previous.signal.aborted).toBe(true);
    await act(async () => finishes[0](responseFor(previous)));
    expect(useSolarStore.getState().masterTrajectory['399']).toBeUndefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const next: Request = mocks.requestTrajectoryBlock.mock.calls[1][0];
    await act(async () => finishes[1](responseFor(next)));
    expect(useSolarStore.getState().masterTrajectory['399']).toHaveLength(200);
  });

  it('does not duplicate pending baseline coverage when a new moon is hovered', async () => {
    mocks.requestTrajectoryBlock.mockImplementation(() => new Promise(() => {}));
    renderHook(() => TrajectoryManager());
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const first: Request = mocks.requestTrajectoryBlock.mock.calls[0][0];
    act(() => useSolarStore.getState().setHoveredPlanetId('501'));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(first.signal.aborted).toBe(false);
    expect(mocks.requestTrajectoryBlock.mock.calls[1][0].ids).toEqual(['501']);
  });

  it('cancels windows overtaken by playback and releases requests on unmount', async () => {
    mocks.requestTrajectoryBlock.mockImplementation(() => new Promise(() => {}));
    const { unmount } = renderHook(() => TrajectoryManager());
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const first: Request = mocks.requestTrajectoryBlock.mock.calls[0][0];
    act(() => advancePlayback(60));
    expect(first.signal.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const next: Request = mocks.requestTrajectoryBlock.mock.calls[1][0];
    expect(next.signal.aborted).toBe(false);
    unmount();
    expect(next.signal.aborted).toBe(true);
  });
});
