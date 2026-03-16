import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api';
import { signBffToken } from '@/lib/bff_auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const bffToken = await signBffToken();
    
    const forwardedFor = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || 'unknown');

    const pythonUrl = process.env.PYTHON_API_URL || API_BASE_URL;
    const apiUrl = `${pythonUrl}/api/ai`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip
    };

    if (bffToken) {
      headers['Authorization'] = `Bearer ${bffToken}`;
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
        return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('[AI Proxy Route] Error:', error);
    return NextResponse.json({ error: 'UPSTREAM_ERROR' }, { status: 502 });
  }
}
