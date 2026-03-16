import { NextRequest, NextResponse } from 'next/server';
import { signBffToken } from '@/lib/bff_auth';

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bffToken = await signBffToken();

  const headers: Record<string, string> = {};
  if (bffToken) {
    headers['Authorization'] = `Bearer ${bffToken}`;
  }

  const params = new URLSearchParams();
  const bodyId = searchParams.get('bodyId');
  const bodyIdSnake = searchParams.get('body_id');
  const sessionId = searchParams.get('sessionId');
  const sessionIdSnake = searchParams.get('session_id');

  if (bodyIdSnake) params.set('body_id', bodyIdSnake);
  else if (bodyId) params.set('body_id', bodyId);
  if (sessionIdSnake) params.set('session_id', sessionIdSnake);
  else if (sessionId) params.set('session_id', sessionId);

  const response = await fetch(`${PYTHON_API_URL}/api/ai/favorites?${params}`, {
    headers,
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const bffToken = await signBffToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (bffToken) {
    headers['Authorization'] = `Bearer ${bffToken}`;
  }

  const response = await fetch(`${PYTHON_API_URL}/api/ai/favorites`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
