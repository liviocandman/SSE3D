'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useUserStore } from '@/store/userStore';
import { useUIStore } from '@/store/uiStore';
import { toast } from 'sonner';

// --- Types ---

export interface FavoritePayload {
  bodyId: string;
  bodyName: string;
  question: string;
  answer: string;
}

export interface Favorite {
  id: number;
  bodyId: string;
  bodyName: string;
  question: string;
  answer: string;
  created_at: string;
}

export class FavoriteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// --- Fetch Helper ---

async function saveFavoriteRequest(
  payload: FavoritePayload,
  sessionId: string,
  isAuthenticated: boolean
): Promise<{ id: number }> {
  const response = await fetch('/api/favorites', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bodyId: payload.bodyId,
      bodyName: payload.bodyName,
      question: payload.question,
      answer: payload.answer,
      sessionId: isAuthenticated ? undefined : sessionId,
    }),
  });

  if (response.status === 403) {
    const data = await response.json();
    throw new FavoriteError(
      data.message || 'Limite atingido',
      403,
      data.error || 'LIMIT_REACHED'
    );
  }

  if (response.status === 503) {
    throw new FavoriteError('Servidor de banco indisponível', 503, 'DATABASE_UNAVAILABLE');
  }

  if (!response.ok) {
    throw new FavoriteError('Erro ao salvar favorito', response.status, 'SERVER_ERROR');
  }

  return response.json();
}

// --- Delete Fetch Helper ---

async function deleteFavoriteRequest(
  id: number,
  isAuthenticated: boolean,
  sessionId: string
): Promise<void> {
  const qs = !isAuthenticated ? `?session_id=${encodeURIComponent(sessionId)}` : '';
  const response = await fetch(`/api/favorites/${id}${qs}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Erro ao remover favorito');
  }
}

// --- useAddFavorite ---

export function useAddFavorite() {
  const queryClient = useQueryClient();
  const sessionId = useUserStore((state) => state.sessionId);
  const { status } = useSession();

  return useMutation({
    mutationFn: async (data: FavoritePayload) => {
      return saveFavoriteRequest(data, sessionId, status === 'authenticated');
    },

    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      queryClient.invalidateQueries({
        queryKey: ['favorites', 'count', variables.bodyId],
      });
    },

    onError: (error) => {
      if (error instanceof FavoriteError) {
        if (error.code === 'LIMIT_REACHED') {
          useUIStore.getState().openAuthModal('favorite_limit');
          return;
        }
      }
      toast.error('Erro ao salvar mensagem.');
    },
  });
}

// --- useRemoveFavorite ---

export function useRemoveFavorite() {
  const queryClient = useQueryClient();
  const sessionId = useUserStore((state) => state.sessionId);
  const { status } = useSession();

  return useMutation({
    mutationFn: async (id: number) => {
      return deleteFavoriteRequest(id, status === 'authenticated', sessionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
    onError: () => {
      toast.error('Erro ao remover favorito.');
    },
  });
}

// --- useFavorites (listagem) ---

export function useFavorites(bodyId?: string) {
  const sessionId = useUserStore((state) => state.sessionId);
  const { status } = useSession();

  return useQuery<Favorite[]>({
    queryKey: ['favorites', bodyId, sessionId, status],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (bodyId) params.set('body_id', bodyId);
      if (status !== 'authenticated') params.set('session_id', sessionId);

      const response = await fetch(`/api/favorites?${params}`);
      if (!response.ok) return [];
      return response.json();
    },
    staleTime: 30_000,
  });
}

// --- useFavoritesCount ---

export function useFavoritesCount(bodyId: string) {
  const { data: favorites = [] } = useFavorites(bodyId);
  const { status } = useSession();

  return {
    count: favorites.length,
    isAtLimit: status !== 'authenticated' && favorites.length >= 2,
    isAuthenticated: status === 'authenticated',
    favorites, 
  };
}
