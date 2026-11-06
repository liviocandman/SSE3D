import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { TRAJECTORY_WORKER_TIMEOUT_MS, useTrajectoryWorker } from './useTrajectoryWorker';

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { MockWorker.instances.push(this); }
  succeed(data: unknown[] = []) {
    const jobId = this.postMessage.mock.calls.find(([message]) => message.type === 'FETCH')![0].jobId;
    this.onmessage?.({ data: { type: 'SUCCESS', jobId, data } } as MessageEvent);
  }
}

describe('useTrajectoryWorker lifecycle', () => {
  beforeEach(() => { MockWorker.instances = []; vi.stubGlobal('Worker', MockWorker); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('does not allocate a worker for a pre-aborted request', async () => {
    const { result } = renderHook(() => useTrajectoryWorker());
    const controller = new AbortController(); controller.abort();
    await expect(result.current.fetchTrajectoryRaw('2026-01-01', 45, ['399'], 'high', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(MockWorker.instances).toHaveLength(0);
  });

  it.each(['error', 'messageerror'] as const)('rejects all pending work on %s and recovers lazily', async (event) => {
    const { result, unmount } = renderHook(() => useTrajectoryWorker());
    const a = result.current.fetchTrajectoryRaw('2026-01-01', 45, ['399'], 'high');
    const b = result.current.fetchTrajectoryRaw('2026-01-01', 45, ['499'], 'high');
    const outcomes = Promise.allSettled([a, b]);
    const worker = MockWorker.instances[0];
    if (event === 'error') worker.onerror?.(new ErrorEvent('error', { message: 'Worker crashed' }));
    else worker.onmessageerror?.();
    expect((await outcomes).map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const next = result.current.fetchTrajectoryRaw('2026-01-01', 45, ['399'], 'high');
    expect(MockWorker.instances).toHaveLength(2);
    MockWorker.instances[1].succeed();
    await expect(next).resolves.toEqual([]);
    unmount();
  });

  it('preserves HTTP status on errors and removes the caller abort listener', async () => {
    const { result } = renderHook(() => useTrajectoryWorker());
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = result.current.fetchTrajectoryRaw('2026-01-01', 45, ['399'], 'high', controller.signal);
    const worker = MockWorker.instances[0];
    const jobId = worker.postMessage.mock.calls[0][0].jobId;
    worker.onmessage?.({ data: { type: 'ERROR', jobId, error: 'Invalid request', status: 422 } } as MessageEvent);
    await expect(pending).rejects.toMatchObject({ status: 422 });
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reconstructs worker recovery hints and protocol errors', async () => {
    const { result } = renderHook(() => useTrajectoryWorker());
    const pending = result.current.fetchTrajectoryRaw('2026-01-01', 45, ['399'], 'high');
    const worker = MockWorker.instances[0];
    const jobId = worker.postMessage.mock.calls[0][0].jobId;
    const retryAt = Date.now() + 1000;
    worker.onmessage?.({ data: { type: 'ERROR', jobId, error: 'Busy', status: 503, retryAt } } as MessageEvent);
    await expect(pending).rejects.toMatchObject({ status: 503, retryAt });
    const invalid = result.current.fetchTrajectoryRaw('2026-01-01', 45, ['399'], 'high');
    const nextId = worker.postMessage.mock.calls[1][0].jobId;
    worker.onmessage?.({ data: { type: 'ERROR', jobId: nextId, error: 'Invalid data', errorName: 'SyntaxError' } } as MessageEvent);
    await expect(invalid).rejects.toBeInstanceOf(SyntaxError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out stuck jobs and terminates the worker', async () => {
    const { result } = renderHook(() => useTrajectoryWorker());
    const promise = result.current.fetchTrajectoryRaw('2026-01-01', 45, ['399'], 'high');
    const expectation = expect(promise).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(TRAJECTORY_WORKER_TIMEOUT_MS);
    await expectation;
    expect(MockWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards cancellation and rejects work on unmount', async () => {
    const { result, unmount } = renderHook(() => useTrajectoryWorker());
    const controller = new AbortController();
    const cancelled = result.current.fetchTrajectoryRaw('2026-01-01', 45, ['399'], 'high', controller.signal);
    const abandoned = result.current.fetchTrajectoryRaw('2026-01-01', 45, ['499'], 'high');
    const outcomes = Promise.allSettled([cancelled, abandoned]);
    controller.abort();
    expect(MockWorker.instances[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'CANCEL' }));
    unmount();
    expect((await outcomes).map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a synchronous postMessage failure without leaking timers', async () => {
    const original = MockWorker;
    vi.stubGlobal('Worker', class extends original {
      postMessage = vi.fn(() => { throw new Error('DataCloneError'); });
    });
    const { result } = renderHook(() => useTrajectoryWorker());
    await expect(result.current.fetchTrajectoryRaw('2026-01-01', 45, ['399'], 'high')).rejects.toThrow('DataCloneError');
    expect(vi.getTimerCount()).toBe(0);
  });
});
