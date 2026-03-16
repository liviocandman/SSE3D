'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useUserStore } from '@/store/userStore';
import { toast } from 'sonner';

export function useSessionMerge() {
  const { status } = useSession();
  const sessionId = useUserStore((state) => state.sessionId);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Only run if authenticated and we have a session ID
    if (status === 'authenticated' && sessionId) {
      const performMerge = async () => {
        try {
          const response = await fetch('/api/users/merge', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ session_id: sessionId }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.migrated > 0) {
              toast.success(`${data.migrated} favoritos sincronizados com sua conta!`);
            }
            queryClient.invalidateQueries({ queryKey: ['favorites'] });
          }
        } catch (error) {
          console.error('[SessionMerge] Error:', error);
        }
      };

      performMerge();
    }
  }, [status, sessionId, queryClient]);
}
