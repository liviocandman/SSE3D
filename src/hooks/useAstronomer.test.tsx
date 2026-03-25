import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAstronomer } from './useAstronomer';
import React from 'react';

// Mock Zustand store
vi.mock('@/store/userStore', () => ({
  useUserStore: (selector: any) => selector({ sessionId: 'test-session-id' }),
}));

describe('useAstronomer', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: {
          retry: false,
        },
      },
    });
    
    // Mock global fetch
    global.fetch = vi.fn();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should include moon specific fields in the request payload', async () => {
    // Setup mock response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ answer: 'This is Europa.' }),
    });

    const { result } = renderHook(() => useAstronomer(), { wrapper });

    act(() => {
      result.current.mutate({
        bodyId: '502',
        date: '2026-03-25',
        question: 'Is there water?',
        bodyType: 'MOON',
        parentName: 'Jupiter',
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bodyId: '502',
        date: '2026-03-25',
        question: 'Is there water?',
        bodyType: 'MOON',
        parentName: 'Jupiter',
        sessionId: 'test-session-id', // From mocked store
      }),
    });
  });
});
