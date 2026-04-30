import 'server-only';
import { NextResponse } from 'next/server';
import { fetchUpstreamWithWakeRetry } from '@/lib/upstreamFetch';

const PYTHON_API_URL = process.env.PYTHON_API_URL;

if (!PYTHON_API_URL && process.env.NODE_ENV === 'production') {
  throw new Error('[BFF] PYTHON_API_URL is required in production');
}

const upstreamBase = PYTHON_API_URL || 'http://localhost:8000';

interface ProxyPostOptions {
  wakeRetry?: boolean;
}

/**
 * Proxy a GET request to the upstream Python API.
 * Uses wake-retry logic for handling cold starts.
 */
export async function proxyGet(
  path: string,
  params?: URLSearchParams,
  headers?: Record<string, string>,
): Promise<NextResponse> {
  const qs = params?.toString();
  const url = qs ? `${upstreamBase}${path}?${qs}` : `${upstreamBase}${path}`;
  
  try {
    const response = await fetchUpstreamWithWakeRetry(url, { 
      headers,
      next: { revalidate: 0 },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return NextResponse.json({ error: 'UPSTREAM_ERROR' }, { status: response.status });
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(`[BFF Proxy] GET ${path} failed:`, error);
    return NextResponse.json({ error: 'NETWORK_ERROR' }, { status: 502 });
  }
}

/**
 * Proxy a POST request to the upstream Python API.
 */
export async function proxyPost(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
  options?: ProxyPostOptions,
): Promise<NextResponse> {
  const url = `${upstreamBase}${path}`;
  
  try {
    const requestInit: RequestInit = {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...headers 
      },
      body: JSON.stringify(body),
    };
    const response = options?.wakeRetry
      ? await fetchUpstreamWithWakeRetry(url, requestInit)
      : await fetch(url, requestInit);
    
    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error(`[BFF Proxy] POST ${path} failed:`, error);
    return NextResponse.json({ error: 'UPSTREAM_ERROR' }, { status: 502 });
  }
}

/**
 * Proxy a DELETE request to the upstream Python API.
 */
export async function proxyDelete(
  path: string,
  params?: URLSearchParams,
  headers?: Record<string, string>,
): Promise<NextResponse> {
  const qs = params?.toString();
  const url = qs ? `${upstreamBase}${path}?${qs}` : `${upstreamBase}${path}`;
  
  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers,
    });
    
    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }
    
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error(`[BFF Proxy] DELETE ${path} failed:`, error);
    return NextResponse.json({ error: 'UPSTREAM_ERROR' }, { status: 502 });
  }
}
