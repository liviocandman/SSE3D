import { NextRequest } from 'next/server';
import { proxyGet } from '@/lib/server/upstream';

export const revalidate = 0;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return proxyGet('/api/missions/artemis2/trajectory', params);
}
