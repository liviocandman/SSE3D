'use client';

import { useUIStore } from '@/store/uiStore';
import { useFavorites, useRemoveFavorite } from '@/hooks/useFavorites';
import { X, Heart, Trash2, Calendar, MapPin } from 'lucide-react';
import { Button } from './Button';
import { format } from 'date-fns';

export function FavoritesModal() {
  const { isFavoritesOpen, closeFavorites } = useUIStore();
  const { data: favorites = [], isLoading } = useFavorites();
  const removeFavorite = useRemoveFavorite();

  if (!isFavoritesOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
      <div 
        className="absolute inset-0" 
        onClick={closeFavorites}
      />
      
      <div className="relative w-full max-w-2xl max-h-[80vh] bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/10 rounded-lg">
              <Heart className="h-5 w-5 text-red-500 fill-red-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white leading-tight">Suas Descobertas</h2>
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Perguntas salvas nos favoritos</p>
            </div>
          </div>
          <button
            onClick={closeFavorites}
            className="p-2 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 border-4 border-white/10 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : favorites.length === 0 ? (
            <div className="text-center py-12 flex flex-col items-center gap-4">
              <div className="p-4 bg-white/5 rounded-full">
                <Heart className="h-8 w-8 text-zinc-600" />
              </div>
              <p className="text-zinc-400 text-sm">Você ainda não salvou nenhuma descoberta.</p>
              <Button 
                variant="outline" 
                onClick={closeFavorites}
                className="text-white border-white/10 hover:bg-white/5"
              >
                Explorar o Sistema Solar
              </Button>
            </div>
          ) : (
            favorites.map((fav) => (
              <div 
                key={fav.id}
                className="group relative bg-white/5 border border-white/5 hover:border-white/10 hover:bg-white/10 rounded-xl p-5 transition-all duration-300 shadow-sm"
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                      <span className="flex items-center gap-1.5 px-2.5 py-1 bg-white/5 rounded-full border border-white/5 group-hover:bg-white/10">
                        <MapPin className="h-3 w-3" />
                        {fav.bodyName}
                      </span>
                      <span className="flex items-center gap-1.5 px-2.5 py-1 bg-white/5 rounded-full border border-white/5 group-hover:bg-white/10">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(fav.created_at), 'dd/MM/yyyy')}
                      </span>
                    </div>
                    <button
                      onClick={() => removeFavorite.mutate(fav.id)}
                      className="p-2 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/10 rounded-lg"
                      title="Remover"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    <p className="text-sky-300 font-semibold text-base leading-snug">
                      "{fav.question}"
                    </p>
                    <p className="text-zinc-400 text-sm leading-relaxed border-l-2 border-white/10 pl-4 py-1 italic">
                      {fav.answer}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        
        {/* Footer */}
        {favorites.length > 0 && (
          <div className="px-6 py-4 border-t border-white/10 bg-black/20 text-center">
            <p className="text-[10px] text-zinc-600 uppercase tracking-[0.2em]">
              Total: {favorites.length} {favorites.length === 1 ? 'favorito' : 'favoritos'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
