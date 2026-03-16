'use client';

import { useMutation } from '@tanstack/react-query';
import { useUserStore } from '@/store/userStore';

export interface AstronomerRequest {
  bodyId: string;
  date: string;
  question: string;
  sessionId?: string;
}

export interface AstronomerResponse {
  answer: string;
}

export class AstronomerError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function requestAstronomer(payload: AstronomerRequest): Promise<AstronomerResponse> {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMessage = 'Erro ao consultar a IA.';
    try {
      const data = await response.json();
      if (typeof data?.detail === 'string' && data.detail.trim().length > 0) {
        errorMessage = data.detail;
      } else if (typeof data?.error === 'string') {
        errorMessage = data.error;
      } else if (typeof data?.message === 'string') {
        errorMessage = data.message;
      }
    } catch {
      // ignore JSON parse errors
    }
    throw new AstronomerError(errorMessage, response.status);
  }

  return response.json();
}

export function useAstronomer() {
  const sessionId = useUserStore((state) => state.sessionId);
  return useMutation({
    mutationFn: (data: Omit<AstronomerRequest, 'sessionId'>) => 
      requestAstronomer({ ...data, sessionId }),
  });
}
