import { create } from 'zustand';

interface UIStore {
  isAuthModalOpen: boolean;
  authModalReason: 'favorite_limit' | 'generic' | null;
  isFavoritesOpen: boolean;
  openAuthModal: (reason?: 'favorite_limit' | 'generic') => void;
  closeAuthModal: () => void;
  openFavorites: () => void;
  closeFavorites: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  isAuthModalOpen: false,
  authModalReason: null,
  isFavoritesOpen: false,

  openAuthModal: (reason = 'generic') => set({
    isAuthModalOpen: true,
    authModalReason: reason,
  }),

  closeAuthModal: () => set({
    isAuthModalOpen: false,
    authModalReason: null,
  }),

  openFavorites: () => set({ isFavoritesOpen: true }),
  closeFavorites: () => set({ isFavoritesOpen: false }),
}));
