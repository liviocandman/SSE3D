import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrajectoryRequestError, TrajectoryRequestDeferredError } from '@/lib/trajectoryRequestErrors';
import { useFullOrbits } from './useFullOrbits';
import { useSolarStore } from '@/store/solarStore';
import type { EphemerisData } from '@/lib/types';

const { requestFullOrbits } = vi.hoisted(() => ({ requestFullOrbits: vi.fn() }));
vi.mock('./useTrajectoryClient', () => ({ useTrajectoryClient: () => ({ requestFullOrbits }) }));
const ids = ['399', '499'];
const earth: EphemerisData = {
  bodyId: '399', name: 'Earth', timestamp: '2026-01-01', position: { x: 1, y: 0, z: 0 },
  trajectory: [
    { timestamp: '2026-01-01', position: { x: 1, y: 0, z: 0 } },
    { timestamp: '2026-01-02', position: { x: 2, y: 0, z: 0 } },
  ],
};

describe('useFullOrbits', () => {
  beforeEach(() => {
    requestFullOrbits.mockReset();
    useSolarStore.setState({ fullOrbits: {}, orbitLines: {}, fullOrbitStatus: {}, fullOrbitRetryAt: {} });
  });

  it('marks a partial response unavailable and does not refetch on rerender or remount', async () => {
    requestFullOrbits.mockResolvedValue([earth, { ...earth, bodyId: '499', trajectory: [] }]);
    const { rerender, unmount } = renderHook(() => useFullOrbits(ids));
    await waitFor(() => expect(useSolarStore.getState().fullOrbitStatus).toEqual({ '399': 'ready', '499': 'unavailable' }));
    rerender();
    act(() => useSolarStore.getState().appendFullOrbits([]));
    unmount();
    renderHook(() => useFullOrbits(ids));
    expect(requestFullOrbits).toHaveBeenCalledOnce();
    expect(useSolarStore.getState().fullOrbits['499']).toBeUndefined();
  });

  it('keeps fallback-only success finite', async () => {
    requestFullOrbits.mockResolvedValue([{ ...earth, trajectory: undefined }]);
    renderHook(() => useFullOrbits(ids));
    await waitFor(() => expect(useSolarStore.getState().fullOrbitStatus['399']).toBe('unavailable'));
    expect(requestFullOrbits).toHaveBeenCalledOnce();
  });

  it('restarts an aborted Strict Mode mount and ignores its stale response', async () => {
    const finishes: ((data: EphemerisData[]) => void)[] = [];
    requestFullOrbits.mockImplementation(() => new Promise((resolve) => { finishes.push(resolve); }));
    renderHook(() => useFullOrbits(ids), {
      // Enable Strict Mode at the root; a nested boundary need not replay effects.
      reactStrictMode: true,
    });
    expect(requestFullOrbits).toHaveBeenCalledTimes(2);
    expect(requestFullOrbits.mock.calls[0][1].aborted).toBe(true);
    expect(requestFullOrbits.mock.calls[1][1].aborted).toBe(false);
    expect(useSolarStore.getState().fullOrbitStatus['399']).toBe('loading');
    await act(async () => finishes[0]([{ ...earth, trajectory: [] }]));
    expect(useSolarStore.getState().fullOrbitStatus['399']).toBe('loading');
    await act(async () => finishes[1]([earth]));
    expect(useSolarStore.getState().fullOrbitStatus).toEqual({ '399': 'ready', '499': 'unavailable' });
  });

  it('cancels on unmount, resets loading and ignores a stale response', async () => {
    let finish!: (data: EphemerisData[]) => void;
    requestFullOrbits.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { unmount } = renderHook(() => useFullOrbits(ids));
    const signal: AbortSignal = requestFullOrbits.mock.calls[0][1];
    expect(useSolarStore.getState().fullOrbitStatus['399']).toBe('loading');
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish([earth]));
    expect(useSolarStore.getState().fullOrbitStatus['399']).toBe('idle');
    expect(useSolarStore.getState().fullOrbits['399']).toBeUndefined();
  });
});

// Recovery uses real hook/store state and a controlled transport clock.
describe('useFullOrbits recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    requestFullOrbits.mockReset();
    useSolarStore.setState({ fullOrbits: {}, orbitLines: {}, fullOrbitStatus: {}, fullOrbitRetryAt: {} });
  });
  afterEach(() => { vi.useRealTimers(); });

  it.each([
    new TrajectoryRequestError('Unavailable', 503),
    new TypeError('fetch failed'),
    new DOMException('Request timed out', 'TimeoutError'),
  ])('recovers from $name after cooldown without remounting', async (error) => {
    requestFullOrbits.mockRejectedValueOnce(error).mockResolvedValueOnce([earth]);
    renderHook(() => useFullOrbits(ids));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(useSolarStore.getState().fullOrbitStatus['399']).toBe('retryable_error');
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(requestFullOrbits).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(requestFullOrbits).toHaveBeenCalledTimes(2);
    expect(useSolarStore.getState().fullOrbitStatus).toEqual({ '399': 'ready', '499': 'unavailable' });
    expect(useSolarStore.getState().fullOrbitRetryAt).toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([1000, 31_000])('preserves recovery eligibility after remount at %i ms', async (elapsed) => {
    requestFullOrbits.mockRejectedValueOnce(new TrajectoryRequestError('Unavailable', 503)).mockResolvedValue([earth]);
    const first = renderHook(() => useFullOrbits(ids));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const retryAt = useSolarStore.getState().fullOrbitRetryAt['399'];
    first.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(elapsed); });
    renderHook(() => useFullOrbits(ids));
    if (elapsed < 30_000) {
      expect(requestFullOrbits).toHaveBeenCalledOnce();
      expect(useSolarStore.getState().fullOrbitRetryAt['399']).toBe(retryAt);
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.max(0, 30_000 - elapsed)); });
    expect(requestFullOrbits).toHaveBeenCalledTimes(2);
    expect(useSolarStore.getState().fullOrbitStatus['399']).toBe('ready');
  });

  it('treats cooldown suppression as deferred work instead of missing geometry', async () => {
    requestFullOrbits.mockRejectedValueOnce(new TrajectoryRequestDeferredError(Date.now() + 5000)).mockResolvedValue([earth]);
    renderHook(() => useFullOrbits(ids));
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
    expect(useSolarStore.getState().fullOrbitStatus['399']).toBe('retryable_error');
    expect(requestFullOrbits).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(useSolarStore.getState().fullOrbitStatus['399']).toBe('ready');
  });

  it('honors a server recovery time longer than the local cooldown', async () => {
    requestFullOrbits.mockRejectedValueOnce(new TrajectoryRequestError('Busy', 503, Date.now() + 60_000)).mockResolvedValue([earth]);
    renderHook(() => useFullOrbits(ids));
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
    expect(requestFullOrbits).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(requestFullOrbits).toHaveBeenCalledTimes(2);
  });

  it('keeps permanent errors distinct from unavailable geometry without automatic loops', async () => {
    requestFullOrbits.mockRejectedValue(new TrajectoryRequestError('Invalid request', 422));
    renderHook(() => useFullOrbits(ids));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(useSolarStore.getState().fullOrbitStatus['399']).toBe('error');
    expect(requestFullOrbits).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('spaces recovery cycles while the backend remains unavailable', async () => {
    requestFullOrbits.mockRejectedValue(new TrajectoryRequestError('Busy', 503));
    const { unmount } = renderHook(() => useFullOrbits(ids));
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(requestFullOrbits).toHaveBeenCalledTimes(4);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
