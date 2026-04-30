import { proxyGet } from '@/lib/server/upstream';

export const revalidate = 0;

export async function GET() {
  return proxyGet('/api/missions/artemis2/health');
}
