import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EphemerisData } from '@/lib/types';

const workerScope = {
  location: { origin: 'https://example.test' },
  onmessage: null as ((event: MessageEvent) => Promise<void>) | null,
  postMessage: vi.fn(),
};

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); workerScope.postMessage.mockReset(); });

describe('trajectory worker sample contract', () => {
  it('preserves 200 scientific samples and their velocities at high quality without densification', async () => {
    const trajectory = Array.from({ length: 200 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString(),
      position: { x: index, y: index * 2, z: index * 3 },
      velocity: { x: 0.1, y: 0.2, z: 0.3 },
    }));
    const body: EphemerisData = {
      bodyId: '399', name: 'Earth', position: trajectory[0].position,
      timestamp: trajectory[0].timestamp, trajectory,
    };
    vi.stubGlobal('self', workerScope);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [body] }) }));
    await import('./trajectory.worker');
    await workerScope.onmessage!({ data: {
      type: 'FETCH', jobId: 'job', params: { date: '2026-01-01', spanDays: 45, ids: ['399'], tier: 'high' },
    } } as MessageEvent);
    const message = workerScope.postMessage.mock.calls[0][0];
    expect(message.type).toBe('SUCCESS');
    expect(message.data[0].trajectory).toHaveLength(200);
    expect(message.data[0].trajectory).toBe(trajectory);
    expect(message.data[0].trajectory[100].velocity).toEqual({ x: 0.1, y: 0.2, z: 0.3 });
  });

  it('retains HTTP status so the client can avoid retrying permanent errors', async () => {
    vi.stubGlobal('self', workerScope);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    await import('./trajectory.worker');
    await workerScope.onmessage!({ data: {
      type: 'FETCH', jobId: 'job', params: { date: '2026-01-01', spanDays: 45, ids: ['399'] },
    } } as MessageEvent);
    expect(workerScope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ERROR', jobId: 'job', status: 422 }));
  });
});


it('transports Retry-After as an absolute recovery time from the worker', async () => {
  vi.useFakeTimers();
  const retryAt = Date.now() + 1000;
  vi.stubGlobal('self', workerScope);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, headers: new Headers({ 'Retry-After': '1' }) }));
  await import('./trajectory.worker');
  await workerScope.onmessage!({ data: {
    type: 'FETCH', jobId: 'recovery', params: { date: '2026-01-01', spanDays: 45, ids: ['399'] },
  } } as MessageEvent);
  expect(workerScope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ERROR', status: 503, retryAt }));
});
