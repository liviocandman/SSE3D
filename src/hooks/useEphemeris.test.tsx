import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useEphemeris } from './useEphemeris';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { DataSource, EphemerisResponse } from '@/lib/types';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function payload(source: DataSource): EphemerisResponse {
  return {
    data: [
      { bodyId: '10', name: 'Sun', position: { x: 0, y: 0, z: 0 }, timestamp: '2026-03-26T00:00:00Z' },
      { bodyId: '199', name: 'Mercury', position: { x: 57_900_000, y: 0, z: 0 },
        timestamp: source === 'SPICE_AND_FALLBACK' || source === 'FALLBACK_DATASET'
          ? '2024-01-01T00:00:00Z' : '2026-03-26T00:00:00Z' },
    ],
    meta: { source, timestamp: '2026-03-26T00:00:00Z', requestedDate: '2026-03-26' },
  };
}

function success(data: EphemerisResponse) {
  return { ok: true, json: async () => data };
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'QueryClientTestWrapper';
  return Wrapper;
};

describe('useEphemeris', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('should fetch data with correct date and spanDays', async () => {
    const mockData = {
      data: [{ bodyId: '10', name: 'Sun', position: { x: 0, y: 0, z: 0 }, timestamp: '2026-03-26' }],
      meta: { source: 'NASA_LIVE' }
    };
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const { result } = renderHook(() => useEphemeris({ date: '2026-03-26', spanDays: 30 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/ephemeris?date=2026-03-26&spanDays=30'),
      expect.any(Object)
    );
    expect(result.current.data).toHaveLength(1);
    expect(result.current.source).toBe('NASA_LIVE');
  });

  it('should handle API errors and return fallback data', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useEphemeris({ date: '2026-03-26' }), {
      wrapper: createWrapper(),
    });

    // Should load fallback data eventually
    await waitFor(() => expect(result.current.isFallback).toBe(true), { timeout: 5000 });
    
    expect(result.current.source).toBe('FALLBACK_DATASET');
    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it('does not retry permanent HTTP errors', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 422 });
    const { result } = renderHook(() => useEphemeris({ date: '2026-03-26' }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isFallback).toBe(true));
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(result.current.error?.canRetry).toBe(false);
  });

  it('should include spanDays in the URL even when not explicitly provided (default 30)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], meta: {} }),
    });

    renderHook(() => useEphemeris({ date: '2026-03-26' }), {
      wrapper: createWrapper(),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('spanDays=30'),
      expect.any(Object)
    );
  });

  it.each([
    ['SPICE_AND_FALLBACK', true], ['FALLBACK_DATASET', true],
    ['SPICE_KERNELS', false], ['CACHE_HIT', false], ['NASA_LIVE', false],
  ] as const)('classifies a successful %s response as degraded: %s', async (source, expected) => {
    const response = payload(source);
    mockFetch.mockResolvedValue(success(response));
    const { result } = renderHook(() => useEphemeris({ date: '2026-03-26' }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(response.data));
    expect(result.current.source).toBe(source);
    expect(result.current.isFallback).toBe(expected);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it.each([
    ['retry', 'SPICE_AND_FALLBACK'], ['refresh', 'SPICE_AND_FALLBACK'],
    ['retry', 'local fallback'], ['refresh', 'local fallback'],
  ] as const)('preserves %s data and warning from %s until a fully SPICE response arrives', async (action, initialSource) => {
    mockFetch.mockResolvedValueOnce(initialSource === 'local fallback'
      ? { ok: false, status: 422 } : success(payload(initialSource)));
    const { result } = renderHook(() => useEphemeris({ date: '2026-03-26' }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isFallback).toBe(true));
    const previousData = result.current.data;
    const previousSource = result.current.source;
    expect(previousData.length).toBeGreaterThan(0);

    let finish!: (response: ReturnType<typeof success>) => void;
    mockFetch.mockReturnValueOnce(new Promise<ReturnType<typeof success>>((resolve) => { finish = resolve; }));
    let refreshPromise: Promise<void> | void;
    act(() => { refreshPromise = result.current[action](); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(result.current.isFallback).toBe(true);
    expect(result.current.source).toBe(previousSource);
    expect(result.current.data).toBe(previousData);
    if (action === 'refresh') expect(mockFetch.mock.calls[1][0]).toContain('force=true');

    const recovered = payload('SPICE_KERNELS');
    await act(async () => {
      finish(success(recovered));
      await refreshPromise;
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(recovered.data);
    expect(result.current.source).toBe('SPICE_KERNELS');
    expect(result.current.isFallback).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('keeps the mixed response classification when a subsequent fetch fails', async () => {
    const mixed = payload('SPICE_AND_FALLBACK');
    mockFetch.mockResolvedValueOnce(success(mixed)).mockResolvedValueOnce({ ok: false, status: 422 });
    const { result } = renderHook(() => useEphemeris({ date: '2026-03-26' }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isFallback).toBe(true));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error?.canRetry).toBe(false));
    expect(result.current.data).toEqual(mixed.data);
    expect(result.current.source).toBe('SPICE_AND_FALLBACK');
    expect(result.current.isFallback).toBe(true);
  });
});

describe('useEphemeris Retry-After', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
    mockFetch.mockReset();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  function unavailable(header: string | null, status = 503) {
    return {
      ok: false, status,
      headers: new Headers(header === null ? {} : { 'Retry-After': header }),
    };
  }

  async function settleFallbackData() {
    await act(async () => {
      // Publish the terminal React Query error before running the error effect.
      await vi.runOnlyPendingTimersAsync();
    });
    await act(async () => {
      // The effect defers a real import; the fake clock cannot complete its I/O.
      await vi.runOnlyPendingTimersAsync();
      await vi.dynamicImportSettled();
    });
  }

  it.each(['seconds', 'http-date'])('waits for the %s header and recovers without fallback', async (format) => {
    const start = Date.now();
    const attempts: number[] = [];
    mockFetch.mockImplementation(async () => {
      attempts.push(Date.now() - start);
      return attempts.length === 1
        ? unavailable(format === 'seconds' ? '10' : new Date(start + 10_000).toUTCString())
        : success(payload('SPICE_KERNELS'));
    });
    const { result } = renderHook(() => useEphemeris({ date: '2026-03-26' }), { wrapper: createWrapper() });
    await act(async () => { await vi.advanceTimersByTimeAsync(9999); });
    expect(attempts).toEqual([0]);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isFallback).toBe(false);
    expect(result.current.source).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(attempts).toEqual([0, 10_000]);
    expect(result.current.source).toBe('SPICE_KERNELS');
    expect(result.current.isFallback).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it.each([null, 'invalid', '0'])('keeps a nonzero local delay for header %s', async (header) => {
    const start = Date.now();
    const attempts: number[] = [];
    mockFetch.mockImplementation(async () => {
      attempts.push(Date.now() - start);
      return attempts.length === 1 ? unavailable(header) : success(payload('SPICE_KERNELS'));
    });
    renderHook(() => useEphemeris({ date: '2026-03-26' }), { wrapper: createWrapper() });
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(attempts).toEqual([0]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(attempts).toEqual([0, 1000]);
  });

  it('uses the new recovery deadline from each HTTP error, including rate limiting', async () => {
    const start = Date.now();
    const attempts: number[] = [];
    mockFetch.mockImplementation(async () => {
      attempts.push(Date.now() - start);
      if (attempts.length === 1) return unavailable('2', 429);
      if (attempts.length === 2) return unavailable('5', 503);
      return success(payload('SPICE_KERNELS'));
    });
    const { result } = renderHook(() => useEphemeris({ date: '2026-03-26' }), { wrapper: createWrapper() });
    await act(async () => { await vi.advanceTimersByTimeAsync(6999); });
    expect(attempts).toEqual([0, 2000]);
    expect(result.current.isFallback).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(attempts).toEqual([0, 2000, 7000]);
    expect(result.current.source).toBe('SPICE_KERNELS');
  });

  it('keeps the three-attempt limit and enters fallback only after the final eligible attempt', async () => {
    const start = Date.now();
    const attempts: number[] = [];
    mockFetch.mockImplementation(async () => {
      attempts.push(Date.now() - start);
      return unavailable('2');
    });
    const { result } = renderHook(() => useEphemeris({ date: '2026-03-26' }), { wrapper: createWrapper() });
    await act(async () => { await vi.advanceTimersByTimeAsync(3999); });
    expect(attempts).toEqual([0, 2000]);
    expect(result.current.isFallback).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(attempts).toEqual([0, 2000, 4000]);
    await settleFallbackData();
    expect(result.current.isFallback).toBe(true);
    expect(result.current.error?.canRetry).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry a permanent HTTP error even when Retry-After is present', async () => {
    mockFetch.mockResolvedValue(unavailable('60', 422));
    const { result } = renderHook(() => useEphemeris({ date: '2026-03-26' }), { wrapper: createWrapper() });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mockFetch).toHaveBeenCalledOnce();
    await settleFallbackData();
    expect(result.current.isFallback).toBe(true);
    expect(result.current.error?.canRetry).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('does not shorten a server wait to fit the per-request timeout', async () => {
    const start = Date.now();
    const attempts: number[] = [];
    mockFetch.mockImplementation(async () => {
      attempts.push(Date.now() - start);
      return attempts.length === 1 ? unavailable('60') : success(payload('SPICE_KERNELS'));
    });
    const { result } = renderHook(() => useEphemeris({ date: '2026-03-26', timeoutMs: 15000 }), { wrapper: createWrapper() });
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
    expect(attempts).toEqual([0]);
    expect(result.current.isFallback).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(attempts).toEqual([0, 60_000]);
    expect(result.current.source).toBe('SPICE_KERNELS');
  });

  it('does not send a scheduled retry after unmount', async () => {
    mockFetch.mockResolvedValue(unavailable('10'));
    const { unmount } = renderHook(() => useEphemeris({ date: '2026-03-26' }), { wrapper: createWrapper() });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mockFetch).toHaveBeenCalledOnce();
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
