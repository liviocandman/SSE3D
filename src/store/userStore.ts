import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface UserStore {
  sessionId: string;
  clearSession: () => void;
}

// Fallback for non-secure contexts (HTTP over network IP) where crypto.randomUUID is unavailable
const generateUUID = () => {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      // Permanent UUID for anonymous identification
      sessionId: generateUUID(),

      clearSession: () => set({ sessionId: generateUUID() }),
    }),
    {
      name: 'sse3d-session',
      storage: createJSONStorage(() => localStorage),
      // Persist only sessionId
      partialize: (state) => ({ sessionId: state.sessionId }),
    }
  )
);
