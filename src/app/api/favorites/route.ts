import { NextRequest, NextResponse } from 'next/server';
import { proxyGet, proxyPost } from '@/lib/server/upstream';
import { signBffToken } from '@/lib/bff_auth';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bffToken = await signBffToken();

  const headers: Record<string, string> = {};
  if (bffToken) {
    headers['Authorization'] = `Bearer ${bffToken}`;
  }

  // The original logic normalized bodyId/sessionId to snake_case for the Python API
  const params = new URLSearchParams();
  const bodyId = searchParams.get('bodyId') || searchParams.get('body_id');
  const sessionId = searchParams.get('sessionId') || searchParams.get('session_id');

  if (bodyId) params.set('body_id', bodyId);
  if (sessionId) params.set('session_id', sessionId);

  return proxyGet('/api/ai/favorites', params, headers, {
    signal: req.signal,
    wakeRetries: 2,
    headOnly: req.method === 'HEAD',
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bffToken = await signBffToken();

    const headers: Record<string, string> = {};
    if (bffToken) {
      headers['Authorization'] = `Bearer ${bffToken}`;
    }

    return proxyPost('/api/ai/favorites', body, headers, { signal: req.signal });
  } catch (error) {
    console.error('[Favorites Proxy Route] Error:', error);
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
}
