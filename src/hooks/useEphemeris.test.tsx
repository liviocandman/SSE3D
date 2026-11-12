import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
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
