import { NextRequest, NextResponse } from 'next/server';
import { getPlanetConfig } from '@/lib/textureConfig';
import { checkRateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MIN_DATE = new Date('1600-01-01');
const MAX_DATE = new Date('2500-01-01');

function isValidDate(dateString: string): boolean {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return false;
  return date >= MIN_DATE && date <= MAX_DATE;
}

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  return 'unknown';
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

  if (!apiKey) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY_NOT_CONFIGURED' },
      { status: 500 }
    );
  }

  let payload: { bodyId?: string; date?: string; question?: string } | null = null;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const bodyId = typeof payload?.bodyId === 'string' ? payload.bodyId.trim() : '';
  const date = typeof payload?.date === 'string' ? payload.date.trim() : '';
  const question = typeof payload?.question === 'string' ? payload.question.trim() : '';

  if (!bodyId || !question || !date) {
    return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  }

  if (!isValidDate(date)) {
    return NextResponse.json({ error: 'INVALID_DATE' }, { status: 400 });
  }

  if (question.length > 500) {
    return NextResponse.json({ error: 'QUESTION_TOO_LONG' }, { status: 400 });
  }

  const config = getPlanetConfig(bodyId);
  if (!config) {
    return NextResponse.json({ error: 'INVALID_BODY_ID' }, { status: 400 });
  }

  const ip = getClientIp(request);
  const rate = await checkRateLimit(ip);

  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfterSeconds: rate.resetSeconds },
      { status: 429 }
    );
  }

  const planetLabel = `${config.englishName} (${config.name})`;
  const systemPrompt =
    `Você é um astrônomo virtual da aplicação Solar Explorer 3D. ` +
    `O usuário está visualizando ${planetLabel} na data ${date}. ` +
    `Responda de forma científica, objetiva e envolvente. ` +
    `Máximo de 2 parágrafos. Não invente dados.`;

  try {
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: question }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 1200,
          temperature: 0.7,
        }
      }),
    });

    if (!response.ok) {
      let detail = '';
      try {
        const errorJson = await response.json();
        detail =
          errorJson?.error?.message ||
          errorJson?.message ||
          JSON.stringify(errorJson);
      } catch {
        detail = await response.text();
      }

      console.error('[AI Route] Gemini error:', response.status, detail);

      const status = response.status === 429 ? 429 : 502;
      const errorCode = response.status === 429 ? 'GEMINI_RATE_LIMIT' : 'GEMINI_API_ERROR';

      return NextResponse.json(
        { error: errorCode, status: response.status, detail },
        { status }
      );
    }

    const data = await response.json();
    const answer: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!answer) {
      return NextResponse.json(
        { error: 'GEMINI_EMPTY_RESPONSE' },
        { status: 502 }
      );
    }

    return NextResponse.json({ answer });
  } catch (error) {
    console.error('[AI Route] Error:', error);
    return NextResponse.json({ error: 'GEMINI_REQUEST_FAILED' }, { status: 502 });
  }
}
