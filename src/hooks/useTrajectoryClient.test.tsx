import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTrajectoryClient } from "./useTrajectoryClient";
import { TrajectoryRequestDeferredError, TrajectoryRequestError } from "@/lib/trajectoryRequestErrors";

const fetchTrajectoryRawMock = vi.fn();

vi.mock("@/hooks/useTrajectoryWorker", () => ({
  useTrajectoryWorker: () => ({
    fetchTrajectoryRaw: fetchTrajectoryRawMock,
  }),
}));

describe("useTrajectoryClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTrajectoryRawMock.mockReset();
    global.fetch = vi.fn();
  });

  it("does not burn orbit-line cooldown when the first request aborts", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          throw new Error("AbortError");
        }
        return {
          ok: true,
          json: async () => ({ data: [] }),
        };
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useTrajectoryClient());
    const abortedController = new AbortController();
    abortedController.abort();

    await expect(
      result.current.requestOrbitLines(["301"], abortedController.signal),
    ).rejects.toThrow("AbortError");

    await expect(result.current.requestOrbitLines(["301"])).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prunes old cooldown entries when the local cache limit is exceeded", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useTrajectoryClient());

    for (let index = 0; index < 51; index += 1) {
      await result.current.requestOrbitLines([String(300 + index)]);
    }

    expect(fetchMock).toHaveBeenCalledTimes(51);

    await result.current.requestOrbitLines(["300"]);

    expect(fetchMock).toHaveBeenCalledTimes(52);
  });
});

describe('useTrajectoryClient request budgets', () => {
  beforeEach(() => { vi.clearAllMocks(); fetchTrajectoryRawMock.mockReset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('retries a transient failure at most three times and cools down failed requests', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const { result } = renderHook(() => useTrajectoryClient());
    const failed = expect(result.current.requestOrbitLines(['301'])).rejects.toThrow('503');
    await vi.advanceTimersByTimeAsync(1_000);
    await failed;
    expect(global.fetch).toHaveBeenCalledTimes(3);
    await expect(result.current.requestOrbitLines(['301'])).rejects.toBeInstanceOf(TrajectoryRequestDeferredError);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry a permanent HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 422 });
    const { result } = renderHook(() => useTrajectoryClient());
    await expect(result.current.requestOrbitLines(['301'])).rejects.toThrow('422');
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('does not retry a permanent error forwarded by the worker', async () => {
    fetchTrajectoryRawMock.mockRejectedValue(new TrajectoryRequestError('Invalid request', 422));
    const { result } = renderHook(() => useTrajectoryClient());
    await expect(result.current.requestTrajectoryBlock({ date: '2026-01-01', spanDays: 45, ids: ['399'], tier: 'high' })).rejects.toMatchObject({ status: 422 });
    expect(fetchTrajectoryRawMock).toHaveBeenCalledOnce();
  });

  it('stops retry backoff immediately when its last caller cancels', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const { result } = renderHook(() => useTrajectoryClient());
    const controller = new AbortController();
    const pending = expect(result.current.requestOrbitLines(['301'], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await pending;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(global.fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps shared work alive until every subscriber cancels', async () => {
    let finish!: (value: unknown) => void;
    global.fetch = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useTrajectoryClient());
    const controller = new AbortController();
    const first = result.current.requestOrbitLines(['301'], controller.signal);
    const second = result.current.requestOrbitLines(['301']);
    const aborted = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await aborted;
    const underlyingSignal = vi.mocked(global.fetch).mock.calls[0][1]?.signal;
    expect(underlyingSignal?.aborted).toBe(false);
    finish({ ok: true, json: async () => ({ data: [] }) });
    await expect(second).resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('enforces a total deadline even if transport never settles', async () => {
    const removeListeners: ReturnType<typeof vi.spyOn>[] = [];
    global.fetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
      removeListeners.push(vi.spyOn(init.signal!, 'removeEventListener'));
      return new Promise(() => {});
    });
    const { result } = renderHook(() => useTrajectoryClient());
    const timedOut = expect(result.current.requestOrbitLines(['301'])).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(45_000);
    await timedOut;
    expect(removeListeners[0]).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(global.fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the underlying request on unmount', async () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    const { result, unmount } = renderHook(() => useTrajectoryClient());
    const cancelled = expect(result.current.requestOrbitLines(['301'])).rejects.toMatchObject({ name: 'AbortError' });
    unmount();
    await cancelled;
    expect(vi.mocked(global.fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useTrajectoryClient Retry-After', () => {
  beforeEach(() => { vi.useFakeTimers(); fetchTrajectoryRawMock.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(['seconds', 'date'])('waits for the backend %s recovery hint on each attempt', async (format) => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false, status: 503,
      headers: new Headers({ 'Retry-After': format === 'seconds' ? '1' : new Date(Date.now() + 2000).toUTCString() }),
    }));
    vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
    const gap = format === 'seconds' ? 1000 : 2000;
    const { result } = renderHook(() => useTrajectoryClient());
    const pending = expect(result.current.requestFullOrbits(['399'])).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(gap - 1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(gap);
    await pending;
    expect(global.fetch).toHaveBeenCalledTimes(3);
    await expect(result.current.requestFullOrbits(['399'])).rejects.toBeInstanceOf(TrajectoryRequestDeferredError);
  });

  it('uses the local backoff when the hint is malformed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, headers: new Headers({ 'Retry-After': 'bad' }) });
    const { result } = renderHook(() => useTrajectoryClient());
    const failed = expect(result.current.requestFullOrbits(['399'])).rejects.toThrow('503');
    await vi.advanceTimersByTimeAsync(299);
    expect(global.fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(600);
    await failed;
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry early when Retry-After exceeds the remaining total deadline', async () => {
    const retryAt = Date.now() + 60_000;
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, headers: new Headers({ 'Retry-After': '60' }) });
    const { result } = renderHook(() => useTrajectoryClient());
    await expect(result.current.requestFullOrbits(['399'])).rejects.toMatchObject({ status: 503, retryAt });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(45_000);
    await expect(result.current.requestFullOrbits(['399'])).rejects.toMatchObject({ name: 'TrajectoryRequestDeferredError', retryAt });
    expect(global.fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15_000);
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: async () => ({ data: [] }) } as Response);
    await expect(result.current.requestFullOrbits(['399'])).resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('honors recovery hints reconstructed from worker errors', async () => {
    fetchTrajectoryRawMock.mockImplementation(async () => { throw new TrajectoryRequestError('Busy', 503, Date.now() + 1000); });
    const { result } = renderHook(() => useTrajectoryClient());
    const pending = expect(result.current.requestTrajectoryBlock({ date: '2026-01-01', spanDays: 45, ids: ['399'], tier: 'high' })).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchTrajectoryRawMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1001);
    await pending;
    expect(fetchTrajectoryRawMock).toHaveBeenCalledTimes(3);
  });

  it('cancels a Retry-After wait without losing the server recovery window', async () => {
    const retryAt = Date.now() + 10_000;
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, headers: new Headers({ 'Retry-After': '10' }) });
    const { result } = renderHook(() => useTrajectoryClient());
    const controller = new AbortController();
    const pending = expect(result.current.requestFullOrbits(['399'], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await pending;
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(result.current.requestFullOrbits(['399'])).rejects.toMatchObject({ name: 'TrajectoryRequestDeferredError', retryAt });
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('does not turn a malformed success payload into unavailable geometry', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() => useTrajectoryClient());
    await expect(result.current.requestFullOrbits(['399'])).rejects.toBeInstanceOf(SyntaxError);
    expect(global.fetch).toHaveBeenCalledOnce();
  });
});
