import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMoonOrbitLines } from './useMoonOrbitLines';
import { useSolarStore } from '@/store/solarStore';
import { PLANET_MOONS } from '@/lib/textureConfig';
import { TrajectoryRequestDeferredError, TrajectoryRequestError } from '@/lib/trajectoryRequestErrors';
import type { EphemerisData } from '@/lib/types';

const request = vi.fn<(ids: string[], signal?: AbortSignal) => Promise<EphemerisData[]>>();
const jupiterIds = PLANET_MOONS['599'];

function moon(bodyId: string, withLine = true): EphemerisData {
  const points = [0, 1].map((index) => ({ x: index, y: 0, z: 0, timestamp: `2026-01-0${index + 1}T00:00:00Z` }));
  return {
    bodyId, name: bodyId, position: points[0], timestamp: points[0].timestamp,
    trajectory: points.map((point) => ({ timestamp: point.timestamp, position: point })),
    orbitLine: withLine ? {
      points, isClosed: true, profile: 'auto', algorithmVersion: 'test',
      sourceWindowStart: points[0].timestamp, sourceWindowEnd: points[1].timestamp,
      inputPointCount: 2, outputPointCount: 2, qualityFlags: [],
    } : undefined,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  request.mockReset().mockImplementation(async (ids) => ids.map((id) => moon(id)));
  useSolarStore.setState({ fullOrbits: {}, orbitLines: {}, orbitLineStatus: {}, orbitLineRetryAt: {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('moon orbit line recovery', () => {
  it('does not schedule work without a moon-system context', async () => {
    renderHook(() => useMoonOrbitLines([], request));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    new TrajectoryRequestError('Busy', 503), new TypeError('fetch failed'),
    new DOMException('Timed out', 'TimeoutError'),
  ])('recovers from $name after cooldown without a context change', async (error) => {
    request.mockRejectedValueOnce(error);
    renderHook(() => useMoonOrbitLines(['599'], request));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(useSolarStore.getState().orbitLineStatus['501']).toBe('retryable_error');
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(request).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(request).toHaveBeenCalledTimes(2);
    for (const id of jupiterIds) {
      expect(useSolarStore.getState().orbitLineStatus[id]).toBe('ready');
      expect(useSolarStore.getState().orbitLines[id]?.points).toHaveLength(2);
    }
    expect(useSolarStore.getState().orbitLineRetryAt).toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resumes a deferred request exactly at its eligibility time', async () => {
    request.mockRejectedValueOnce(new TrajectoryRequestDeferredError(Date.now() + 5000));
    renderHook(() => useMoonOrbitLines(['599'], request));
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
    expect(request).toHaveBeenCalledOnce();
    expect(useSolarStore.getState().orbitLineStatus['501']).toBe('retryable_error');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(useSolarStore.getState().orbitLineStatus['501']).toBe('ready');
  });

  it('cancels scheduling outside the context and preserves the deadline when returning', async () => {
    request.mockRejectedValueOnce(new TrajectoryRequestError('Busy', 503));
    const scene = renderHook(({ parents }) => useMoonOrbitLines(parents, request), { initialProps: { parents: ['599'] } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const retryAt = useSolarStore.getState().orbitLineRetryAt['501'];
    scene.rerender({ parents: [] });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    scene.rerender({ parents: ['599'] });
    await act(async () => { await vi.advanceTimersByTimeAsync(retryAt - Date.now() - 1); });
    expect(request).toHaveBeenCalledOnce();
    expect(useSolarStore.getState().orbitLineRetryAt['501']).toBe(retryAt);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('aborts obsolete requests and ignores late responses from the old context', async () => {
    let finish!: (data: EphemerisData[]) => void;
    request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const scene = renderHook(({ parents }) => useMoonOrbitLines(parents, request), { initialProps: { parents: ['599'] } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const signal = request.mock.calls[0][1]!;
    scene.rerender({ parents: ['699'] });
    expect(signal.aborted).toBe(true);
    expect(useSolarStore.getState().orbitLineStatus['501']).toBe('idle');
    await act(async () => { finish(jupiterIds.map((id) => moon(id))); });
    expect(useSolarStore.getState().orbitLines['501']).toBeUndefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(useSolarStore.getState().orbitLineStatus['601']).toBe('ready');
  });

  it('rechecks the store and requests only lines still missing at recovery time', async () => {
    request.mockRejectedValueOnce(new TrajectoryRequestError('Busy', 503));
    renderHook(() => useMoonOrbitLines(['599'], request));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    act(() => useSolarStore.getState().appendFullOrbits([moon('501')]));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(request.mock.calls[1][0]).toEqual(['502', '503', '504']);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps valid partial responses finite and does not confuse raw trajectories with orbit lines', async () => {
    request.mockResolvedValueOnce(jupiterIds.map((id) => moon(id, id === '501')));
    const first = renderHook(() => useMoonOrbitLines(['599'], request));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(useSolarStore.getState().orbitLineStatus).toEqual({
      '501': 'ready', '502': 'unavailable', '503': 'unavailable', '504': 'unavailable',
    });
    expect(useSolarStore.getState().fullOrbits['502']).toHaveLength(2);
    first.unmount();
    renderHook(() => useMoonOrbitLines(['599'], request));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(request).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([new TrajectoryRequestError('Invalid', 422), new SyntaxError('Malformed response')])(
    'does not recover automatically from permanent $name errors', async (error) => {
      request.mockRejectedValue(error);
      renderHook(() => useMoonOrbitLines(['599'], request));
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(request).toHaveBeenCalledOnce();
      expect(useSolarStore.getState().orbitLineStatus['501']).toBe('error');
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('preserves one pending request for an equivalent normalized context', async () => {
    request.mockImplementation(() => new Promise(() => {}));
    const scene = renderHook(({ parents }) => useMoonOrbitLines(parents, request), { initialProps: { parents: ['599'] } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const signal = request.mock.calls[0][1]!;
    scene.rerender({ parents: ['599', '599'] });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(signal.aborted).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    scene.unmount();
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers independent moon systems at their own deadlines', async () => {
    const start = Date.now();
    const attempts = new Set<string>();
    request.mockImplementation(async (ids) => {
      const group = ids[0];
      if (!attempts.has(group)) {
        attempts.add(group);
        throw new TrajectoryRequestError('Busy', 503, group === '501' ? start + 60_000 : undefined);
      }
      return ids.map((id) => moon(id));
    });
    renderHook(() => useMoonOrbitLines(['599', '699'], request));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_250); });
    expect(request).toHaveBeenCalledTimes(3);
    expect(useSolarStore.getState().orbitLineStatus['601']).toBe('ready');
    expect(useSolarStore.getState().orbitLineStatus['501']).toBe('retryable_error');
    await act(async () => { await vi.advanceTimersByTimeAsync(29_750); });
    expect(request).toHaveBeenCalledTimes(4);
    expect(useSolarStore.getState().orbitLineStatus['501']).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });
});
