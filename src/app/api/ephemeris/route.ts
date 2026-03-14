import { NextRequest, NextResponse } from 'next/server';
import { getCachedBulkEphemeris } from '@/services/cacheService';
import { BODY_IDS } from '@/services/nasaClient';
import { API_BASE_URL } from '@/lib/api';

const ALL_PLANET_IDS = Object.values(BODY_IDS);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0];
  const force = searchParams.get('force') === 'true';
  const idsParam = searchParams.get('ids');
  
  const bodyIds = idsParam 
    ? idsParam.split(',').map(id => id.trim()) 
    : ALL_PLANET_IDS;

  if (!force) {
    const cacheResult = await getCachedBulkEphemeris(bodyIds, date);
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
  const pythonUrl = process.env.PYTHON_API_URL || API_BASE_URL;
  const apiUrl = `${pythonUrl}/api/ephemeris?date=${date}${idsQuery}${forceQuery}`;

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
