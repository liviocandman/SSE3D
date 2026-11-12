// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUpstreamWithWakeRetry } from './upstreamFetch';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('upstream request budget', () => {
  it('does not multiply the caller retry budget by default', async () => {
    fetchMock.mockResolvedValue(new Response('unavailable', { status: 503 }));
    const response = await fetchUpstreamWithWakeRetry('http://upstream');
    expect(await response.text()).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels discarded responses and caps explicit read retries', async () => {
    const cancel = vi.fn();
    fetchMock.mockImplementation(async () => new Response(
      new ReadableStream({ cancel }), { status: 503 },
    ));
    const request = fetchUpstreamWithWakeRetry('http://upstream', {}, 99);
    await vi.advanceTimersByTimeAsync(1_050);
    const response = await request;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(cancel).toHaveBeenCalledTimes(2);
    await response.body!.cancel();
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['POST', 'DELETE'])('never replays a %s operation after an ambiguous failure', async (method) => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(fetchUpstreamWithWakeRetry('http://upstream', { method }, 2))
      .rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry a permanent HTTP error', async () => {
    fetchMock.mockResolvedValue(new Response('invalid', { status: 422 }));
    const response = await fetchUpstreamWithWakeRetry('http://upstream', {}, 2);
    await response.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not start an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchUpstreamWithWakeRetry('http://upstream', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('interrupts backoff immediately when its caller cancels', async () => {
    fetchMock.mockResolvedValue(new Response('sleeping', { status: 503 }));
    const controller = new AbortController();
    const request = fetchUpstreamWithWakeRetry('http://upstream', { signal: controller.signal }, 2);
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses one deadline across attempts and backoff', async () => {
    fetchMock.mockResolvedValue(new Response('sleeping', { status: 503 }));
    const request = fetchUpstreamWithWakeRetry('http://upstream', {}, 2, 100);
    const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a fetch that does not return headers before the deadline', async () => {
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    const request = fetchUpstreamWithWakeRetry('http://upstream', {}, 2, 100);
    const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the deadline active after headers while the body is stalled', async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const response = await fetchUpstreamWithWakeRetry('http://upstream', {}, 0, 100);
    const rejection = expect(response.text()).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates caller cancellation after headers and releases its listener', async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const response = await fetchUpstreamWithWakeRetry('http://upstream', { signal: controller.signal });
    const rejection = expect(response.text()).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the deadline and upstream reader when the downstream cancels', async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const response = await fetchUpstreamWithWakeRetry('http://upstream');
    await response.body!.cancel('client disconnected');
    expect(cancel).toHaveBeenCalledWith('client disconnected');
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
