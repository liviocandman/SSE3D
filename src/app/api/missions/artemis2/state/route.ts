import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api';
import { fetchUpstreamWithWakeRetry } from '@/lib/upstreamFetch';

export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const at = searchParams.get('at');
  const pythonUrl = process.env.PYTHON_API_URL || API_BASE_URL;
  const url = new URL(`${pythonUrl}/api/missions/artemis2/state`);
  if (at) {
    url.searchParams.set('at', at);
  }

  try {
    const res = await fetchUpstreamWithWakeRetry(url.toString(), { cache: 'no-store' });

    if (!res.ok) {
      return NextResponse.json(
        { error: 'UPSTREAM_ERROR' },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Mission State API Proxy] Error:', error);
    return NextResponse.json(
      { error: 'NETWORK_ERROR' },
      { status: 502 }
    );
  }
}
