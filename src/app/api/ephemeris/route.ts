import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api';
import { fetchUpstreamWithWakeRetry } from '@/lib/upstreamFetch';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0];
  const spanDays = searchParams.get('spanDays') ?? '30';
  const force = searchParams.get('force') === 'true';
  const idsParam = searchParams.get('ids');
  const centerBody = searchParams.get('center_body') ?? '10';
  const fullOrbit = searchParams.get('fullOrbit') === 'true';
  const orbitReady = searchParams.get('orbitReady') ?? 'false';
  const orbitProfile = searchParams.get('orbitProfile') ?? 'auto';
  const orbitLineOnly = searchParams.get('orbitLineOnly') ?? 'false';

  const idsQuery = idsParam ? `&ids=${idsParam}` : '';
  const forceQuery = force ? '&force=true' : '';
  const centerQuery = centerBody !== '10' ? `&center_body=${centerBody}` : '';
  const fullOrbitQuery = fullOrbit ? '&fullOrbit=true' : '';
  const orbitReadyQuery = orbitReady === 'true' ? '&orbitReady=true' : '';
  const orbitProfileQuery = orbitProfile !== 'auto' ? `&orbitProfile=${orbitProfile}` : '';
  const orbitLineOnlyQuery = orbitLineOnly === 'true' ? '&orbitLineOnly=true' : '';
  const spanQuery = `&spanDays=${spanDays}`;
  const pythonUrl = process.env.PYTHON_API_URL || API_BASE_URL;
  const apiUrl = `${pythonUrl}/api/ephemeris?date=${date}${idsQuery}${centerQuery}${forceQuery}${spanQuery}${fullOrbitQuery}${orbitReadyQuery}${orbitProfileQuery}${orbitLineOnlyQuery}`;

  try {
    const response = await fetchUpstreamWithWakeRetry(apiUrl, { next: { revalidate: 0 } });
    if (!response.ok) {
      return NextResponse.json(
        { error: 'UPSTREAM_ERROR' },
        { status: response.status }
      );
    }
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Ephemeris API Proxy] Error:', error);
    return NextResponse.json(
      { error: 'NETWORK_ERROR' }, 
      { status: 502 }
    );
  }
}
