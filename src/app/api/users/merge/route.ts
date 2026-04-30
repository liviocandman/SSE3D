import { NextRequest, NextResponse } from 'next/server';
import { signBffToken } from '@/lib/bff_auth';
import { proxyPost } from '@/lib/server/upstream';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bffToken = await signBffToken();

    if (!bffToken) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${bffToken}`,
    };

    return proxyPost('/api/users/merge-anonymous', body, headers);
  } catch (error) {
    console.error('[User Merge Proxy Route] Error:', error);
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
}
