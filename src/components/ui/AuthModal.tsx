'use client';

import { useUIStore } from '@/store/uiStore';
import { signIn } from 'next-auth/react';
import { X, Github, Cloud } from 'lucide-react';
import { Button } from './Button';

export function AuthModal() {
  const { isAuthModalOpen, authModalReason, closeAuthModal } = useUIStore();

  if (!isAuthModalOpen) return null;

  const isLimitReached = authModalReason === 'favorite_limit';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative w-full max-w-md scale-100 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 p-8 shadow-2xl animate-in zoom-in-95 duration-300">
        {/* Close Button */}
        <button
          onClick={closeAuthModal}
          className="absolute right-4 top-4 rounded-full p-2 text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Content */}
        <div className="space-y-6 text-center">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-white">
              {isLimitReached ? 'Limite de Favoritos' : 'Acesse sua conta'}
            </h2>
            <p className="text-zinc-400 text-sm">
              {isLimitReached
                ? 'Você atingiu o limite de 2 favoritos por planeta. Faça login para salvar perguntas ilimitadas!'
                : 'Salva suas descobertas e acesse de qualquer dispositivo.'}
            </p>
          </div>

          <div className="grid gap-3">
            <Button
              onClick={() => signIn('google')}
              className="w-full h-12 flex items-center justify-center gap-3 bg-white text-black hover:bg-zinc-200 transition-all font-medium rounded-xl"
            >
              {/* Note: In a real app I'd use a Google icon SVG */}
              Continuar com Google
            </Button>

            <Button
              onClick={() => signIn('github')}
              variant="outline"
              className="w-full h-12 flex items-center justify-center gap-3 border-zinc-700 bg-transparent text-white hover:bg-zinc-800 transition-all font-medium rounded-xl"
            >
              <Github className="h-5 w-5" />
              Continuar com GitHub
            </Button>
          </div>

          <p className="text-[10px] text-zinc-500 pt-4">
            Ao continuar, você concorda com nossos termos de uso e privacidade.
          </p>
        </div>
      </div>
    </div>
  );
}
