import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useEphemeris } from './useEphemeris';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

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
});
