import { NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api';

export const revalidate = 0;

export async function GET() {
  const pythonUrl = process.env.PYTHON_API_URL || API_BASE_URL;
  const url = `${pythonUrl}/api/missions/artemis2/trajectory`;

  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 0 }
    });
    
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch mission trajectory' }, { status: res.status });
    }
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('BFF Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
