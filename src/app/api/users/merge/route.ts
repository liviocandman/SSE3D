import { NextRequest, NextResponse } from 'next/server';
import { signBffToken } from '@/lib/bff_auth';

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const bffToken = await signBffToken();

  if (!bffToken) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const response = await fetch(`${PYTHON_API_URL}/api/users/merge-anonymous`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bffToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
