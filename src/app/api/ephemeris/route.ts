import { NextRequest } from 'next/server';
import { proxyGet } from '@/lib/server/upstream';

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  return proxyGet('/api/ephemeris', params);
}
