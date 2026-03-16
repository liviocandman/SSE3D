import { NextRequest, NextResponse } from 'next/server';
import { signBffToken } from '@/lib/bff_auth';

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bffToken = await signBffToken();
  const { searchParams } = new URL(req.url);

  const headers: Record<string, string> = {};
  if (bffToken) {
    headers['Authorization'] = `Bearer ${bffToken}`;
  }

  const sessionId = searchParams.get('session_id') || searchParams.get('sessionId');
  const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';

  const response = await fetch(`${PYTHON_API_URL}/api/ai/favorites/${id}${qs}`, {
    method: 'DELETE',
    headers,
  });

  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
