import { NextRequest, NextResponse } from 'next/server';
import { getCachedBulkEphemeris } from '@/services/cacheService';
import { BODY_IDS } from '@/services/nasaClient';
import { API_BASE_URL } from '@/lib/api';

const ALL_PLANET_IDS = Object.values(BODY_IDS);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0];
  const spanDays = searchParams.get('spanDays') ?? '30';
  const force = searchParams.get('force') === 'true';
  const idsParam = searchParams.get('ids');
  const centerBody = searchParams.get('center_body') ?? '10';
  const fullOrbit = searchParams.get('fullOrbit') === 'true';
  
  const bodyIds = idsParam 
    ? idsParam.split(',').map(id => id.trim()) 
    : ALL_PLANET_IDS;

  // Include spanDays and fullOrbit in the cache key
  const cacheKeyDate = fullOrbit ? 'FULL_ORBIT' : `${date}_${spanDays}`;

  if (!force) {
    const cacheResult = await getCachedBulkEphemeris(bodyIds, cacheKeyDate, centerBody);
    if (cacheResult.missing.length === 0 && cacheResult.cached.length > 0) {
      return NextResponse.json({
        data: cacheResult.cached,
        meta: {
          source: 'CACHE_HIT',
          timestamp: new Date().toISOString(),
          requestedDate: date,
          cacheHits: cacheResult.cached.length,
          cacheMisses: 0,
        }
      });
    }
  }

  const idsQuery = idsParam ? `&ids=${idsParam}` : '';
  const forceQuery = force ? '&force=true' : '';
  const centerQuery = centerBody !== '10' ? `&center_body=${centerBody}` : '';
  const fullOrbitQuery = fullOrbit ? '&fullOrbit=true' : '';
  const spanQuery = `&spanDays=${spanDays}`;
  const pythonUrl = process.env.PYTHON_API_URL || API_BASE_URL;
  const apiUrl = `${pythonUrl}/api/ephemeris?date=${date}${idsQuery}${centerQuery}${forceQuery}${spanQuery}${fullOrbitQuery}`;

  try {
    const response = await fetch(apiUrl, { next: { revalidate: 0 } });
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
