// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { proxyDelete, proxyGet, proxyPost } from './upstream';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('BFF proxy', () => {
  it('streams unmodified bytes without JSON parsing or stale compression headers', async () => {
    const raw = '{ "data": [], "precise": 9007199254740993 }';
    const upstream = new Response(raw, { headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'content-length': '42',
    } });
    const json = vi.spyOn(upstream, 'json');
    fetchMock.mockResolvedValue(upstream);
    const response = await proxyGet('/api/ephemeris', new URLSearchParams({ ids: '399' }));
    expect(await response.text()).toBe(raw);
    expect(json).not.toHaveBeenCalled();
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.has('content-encoding')).toBe(false);
  });

  it('preserves validation status and retry advice without retrying ephemeris', async () => {
    fetchMock.mockResolvedValue(new Response('{"detail":"capacity full"}', {
      status: 503, headers: { 'retry-after': '1' },
    }));
    const response = await proxyGet('/api/ephemeris');
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await response.json()).toEqual({ detail: 'capacity full' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves creation status and does not replay POST', async () => {
    fetchMock.mockResolvedValue(new Response('{"id":1}', { status: 201 }));
    const response = await proxyPost('/api/ai/favorites', { bodyId: '399' });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves empty delete responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const response = await proxyDelete('/api/ai/favorites/1');
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('releases a HEAD response without relying on Next to consume the body', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel }), {
      headers: { 'content-type': 'application/json' },
    }));
    const response = await proxyGet('/api/ephemeris', undefined, undefined, { headOnly: true });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.body).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns timeout status when upstream headers exceed the deadline', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
    }));
    const pending = proxyGet('/api/ephemeris', undefined, undefined, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'UPSTREAM_TIMEOUT' });
  });

  it('forwards the incoming request cancellation to fetch', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
    }));
    const pending = proxyGet('/api/ephemeris', undefined, undefined, { signal: controller.signal });
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
});
