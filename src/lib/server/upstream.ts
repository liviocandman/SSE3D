import 'server-only';
import { NextResponse } from 'next/server';
import { fetchUpstreamWithWakeRetry } from '@/lib/upstreamFetch';

const PYTHON_API_URL = process.env.PYTHON_API_URL;

if (!PYTHON_API_URL && process.env.NODE_ENV === 'production') {
  throw new Error('[BFF] PYTHON_API_URL is required in production');
}

const upstreamBase = PYTHON_API_URL || 'http://localhost:8000';

interface ProxyOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface ProxyGetOptions extends ProxyOptions {
  /** Enable only when the caller does not already own a retry budget. */
  wakeRetries?: number;
  headOnly?: boolean;
}

function forwardResponse(response: Response, headOnly = false): NextResponse {
  // Fetch can decompress the upstream body. Content-length, content-encoding
  // and hop-by-hop headers must not be forwarded for the resulting stream.
  const headers = new Headers();
  for (const name of ['content-type', 'cache-control', 'retry-after']) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(headOnly ? null : response.body, { status: response.status, headers });
}

function proxyError(error: unknown, signal?: AbortSignal): NextResponse {
  if (signal?.aborted) {
    return NextResponse.json({ error: 'REQUEST_ABORTED' }, { status: 499 });
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return NextResponse.json({ error: 'UPSTREAM_TIMEOUT' }, { status: 504 });
  }
  console.error('[BFF Proxy] Upstream request failed:', error);
  return NextResponse.json({ error: 'UPSTREAM_ERROR' }, { status: 502 });
}

export async function proxyGet(
  path: string,
  params?: URLSearchParams,
  headers?: Record<string, string>,
  options: ProxyGetOptions = {},
): Promise<NextResponse> {
  const qs = params?.toString();
  const url = qs ? `${upstreamBase}${path}?${qs}` : `${upstreamBase}${path}`;
  try {
    const response = await fetchUpstreamWithWakeRetry(url, {
      headers,
      signal: options.signal,
      cache: 'no-store',
    }, options.wakeRetries ?? 0, options.timeoutMs);
    // Next reuses GET handlers for HEAD but never consumes their response body.
    if (options.headOnly) await response.body?.cancel();
    return forwardResponse(response, options.headOnly);
  } catch (error) {
    return proxyError(error, options.signal);
  }
}

export async function proxyPost(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
  options: ProxyOptions = {},
): Promise<NextResponse> {
  try {
    return forwardResponse(await fetchUpstreamWithWakeRetry(`${upstreamBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: options.signal,
    }, 0, options.timeoutMs));
  } catch (error) {
    return proxyError(error, options.signal);
  }
}

export async function proxyDelete(
  path: string,
  params?: URLSearchParams,
  headers?: Record<string, string>,
  options: ProxyOptions = {},
): Promise<NextResponse> {
  const qs = params?.toString();
  const url = qs ? `${upstreamBase}${path}?${qs}` : `${upstreamBase}${path}`;
  try {
    return forwardResponse(await fetchUpstreamWithWakeRetry(url, {
      method: 'DELETE',
      headers,
      signal: options.signal,
    }, 0, options.timeoutMs));
  } catch (error) {
    return proxyError(error, options.signal);
  }
}
