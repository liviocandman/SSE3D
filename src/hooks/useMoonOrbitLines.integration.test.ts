import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMoonOrbitLines } from './useMoonOrbitLines';
import { useTrajectoryClient } from './useTrajectoryClient';
import { useSolarStore } from '@/store/solarStore';
import { PLANET_MOONS } from '@/lib/textureConfig';
import type { EphemerisData } from '@/lib/types';

function orbitLine(bodyId: string): EphemerisData {
  const points = [0, 1].map((index) => ({ x: index, y: 0, z: 0, timestamp: `2026-01-0${index + 1}T00:00:00Z` }));
  return {
    bodyId, name: bodyId, position: points[0], timestamp: points[0].timestamp,
    orbitLine: {
      points, isClosed: true, profile: 'auto', algorithmVersion: 'test',
      sourceWindowStart: points[0].timestamp, sourceWindowEnd: points[1].timestamp,
      inputPointCount: 2, outputPointCount: 2, qualityFlags: [],
    },
  };
}

function useContext(parents: string[]) {
  const { requestOrbitLines } = useTrajectoryClient();
  useMoonOrbitLines(parents, requestOrbitLines);
}

describe('moon orbit lines through the real request client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
    useSolarStore.setState({ fullOrbits: {}, orbitLines: {}, orbitLineStatus: {}, orbitLineRetryAt: {} });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each([false, true])('recovers after the single transport retry budget (remount: %s)', async (remount) => {
    const start = Date.now();
    const attempts: number[] = [];
    const fetchMock = vi.fn<typeof fetch>(async () => {
      attempts.push(Date.now() - start);
      return attempts.length <= 3
        ? new Response('', { status: 503, headers: { 'Retry-After': '1' } })
        : new Response(JSON.stringify({ data: PLANET_MOONS['599'].map(orbitLine) }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    let scene = renderHook(() => useContext(['599']));
    await act(async () => { await vi.advanceTimersByTimeAsync(2250); });
    expect(attempts).toEqual([250, 1250, 2250]);
    expect(useSolarStore.getState().orbitLineRetryAt['501']).toBe(start + 32_250);
    expect(useSolarStore.getState().orbitLineStatus['501']).toBe('retryable_error');
    if (remount) {
      scene.unmount();
      expect(vi.getTimerCount()).toBe(0);
      scene = renderHook(() => useContext(['599']));
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(attempts).toEqual([250, 1250, 2250, 32_250]);
    expect(fetchMock.mock.calls[0][0]).toContain('orbitReady=true');
    expect(fetchMock.mock.calls[0][0]).toContain('orbitLineOnly=true');
    for (const id of PLANET_MOONS['599']) {
      expect(useSolarStore.getState().orbitLineStatus[id]).toBe('ready');
      expect(useSolarStore.getState().orbitLines[id].points).toHaveLength(2);
    }
    expect(useSolarStore.getState().orbitLineRetryAt).toEqual({});
    scene.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors Retry-After beyond the transport deadline instead of restarting early', async () => {
    const start = Date.now();
    const attempts: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts.push(Date.now() - start);
      return attempts.length === 1
        ? new Response('', { status: 503, headers: { 'Retry-After': '60' } })
        : new Response(JSON.stringify({ data: PLANET_MOONS['599'].map(orbitLine) }), { status: 200 });
    }));
    renderHook(() => useContext(['599']));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_249); });
    expect(attempts).toEqual([250]);
    expect(useSolarStore.getState().orbitLineRetryAt['501']).toBe(start + 60_250);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(attempts).toEqual([250, 60_250]);
    expect(useSolarStore.getState().orbitLineStatus['501']).toBe('ready');
  });

  it('cancels transport backoff when the moon system leaves the context', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 503, headers: { 'Retry-After': '1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const scene = renderHook(({ parents }) => useContext(parents), { initialProps: { parents: ['599'] } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(fetchMock).toHaveBeenCalledOnce();
    scene.rerender({ parents: [] });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(useSolarStore.getState().orbitLineStatus['501']).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });
});
