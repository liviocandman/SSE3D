import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFullOrbits } from './useFullOrbits';
import { useSolarStore } from '@/store/solarStore';
import type { EphemerisData } from '@/lib/types';

const earth: EphemerisData = {
  bodyId: '399', name: 'Earth', timestamp: '2026-01-01', position: { x: 1, y: 0, z: 0 },
  trajectory: [
    { timestamp: '2026-01-01', position: { x: 1, y: 0, z: 0 } },
    { timestamp: '2026-01-02', position: { x: 2, y: 0, z: 0 } },
  ],
};

describe('full orbit recovery through the real request client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
    useSolarStore.setState({ fullOrbits: {}, orbitLines: {}, fullOrbitStatus: {}, fullOrbitRetryAt: {} });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([false, true])('recovers after Retry-After and cooldown (remount: %s)', async (remount) => {
    const start = Date.now();
    const attempts: number[] = [];
    const fetchMock = vi.fn(async () => {
      attempts.push(Date.now() - start);
      return attempts.length <= 3
        ? new Response('', { status: 503, headers: { 'Retry-After': '1' } })
        : new Response(JSON.stringify({ data: [earth] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    let scene = renderHook(() => useFullOrbits(['399']));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(attempts).toEqual([0, 1000, 2000]);
    expect(useSolarStore.getState().fullOrbitStatus['399']).toBe('retryable_error');
    expect(useSolarStore.getState().fullOrbitRetryAt['399']).toBe(start + 32_000);

    if (remount) {
      scene.unmount();
      scene = renderHook(() => useFullOrbits(['399']));
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(useSolarStore.getState().fullOrbitStatus['399']).toBe('retryable_error');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(attempts).toEqual([0, 1000, 2000, 32_000]);
    expect(useSolarStore.getState().fullOrbitStatus['399']).toBe('ready');
    expect(useSolarStore.getState().fullOrbits['399']).toEqual(earth.trajectory);
    expect(useSolarStore.getState().fullOrbitRetryAt).toEqual({});
    scene.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
