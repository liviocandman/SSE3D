import { NextRequest, NextResponse } from 'next/server';
import { proxyPost } from '@/lib/server/upstream';
import { signBffToken } from '@/lib/bff_auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const bffToken = await signBffToken();
    
    const forwardedFor = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || 'unknown');

    const headers: Record<string, string> = { 'x-forwarded-for': ip };
    if (bffToken) {
      headers['Authorization'] = `Bearer ${bffToken}`;
    }

    return proxyPost('/api/ai', payload, headers, { wakeRetry: true });
  } catch (error) {
    console.error('[AI Proxy Route] Error:', error);
    return NextResponse.json({ error: 'UPSTREAM_ERROR' }, { status: 502 });
  }
}
