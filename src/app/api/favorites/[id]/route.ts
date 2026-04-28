import { NextRequest } from 'next/server';
import { signBffToken } from '@/lib/bff_auth';
import { proxyDelete } from '@/lib/server/upstream';

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
  const proxyParams = new URLSearchParams();
  if (sessionId) proxyParams.set('session_id', sessionId);

  return proxyDelete(`/api/ai/favorites/${id}`, proxyParams, headers);
}
