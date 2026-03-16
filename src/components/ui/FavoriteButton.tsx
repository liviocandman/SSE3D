'use client';

import { Heart } from 'lucide-react';
import { useAddFavorite, useRemoveFavorite, useFavoritesCount } from '@/hooks/useFavorites';
import { cn } from '@/lib/utils';
import { Button } from './Button';
import { toast } from 'sonner';

interface FavoriteButtonProps {
  bodyId: string;
  bodyName: string;
  question: string;
  answer: string;
  className?: string;
}

export function FavoriteButton({
  bodyId,
  bodyName,
  question,
  answer,
  className,
}: FavoriteButtonProps) {
  const addFavorite = useAddFavorite();
  const removeFavorite = useRemoveFavorite();
  const { favorites, isAtLimit, isAuthenticated } = useFavoritesCount(bodyId);

  const favoriteItem = favorites.find(
    (f) => f.question === question && f.answer === answer
  );
  const isFavorited = !!favoriteItem;

  const handleToggle = () => {
    if (isFavorited) {
      removeFavorite.mutate(favoriteItem.id);
      toast.success('Removido dos favoritos');
    } else {
      addFavorite.mutate({ bodyId, bodyName, question, answer }, {
        onSuccess: () => toast.success('Pergunta salva nos favoritos!')
      });
    }
  };

  return (
    <Button
      onClick={handleToggle}
      disabled={addFavorite.isPending || removeFavorite.isPending}
      variant="ghost"
      size="icon"
      className={cn(
        "h-8 w-8 rounded-full transition-all group",
        isAtLimit && !isAuthenticated && !isFavorited && "opacity-50 grayscale hover:grayscale-0",
        (addFavorite.isPending || removeFavorite.isPending) && "animate-pulse",
        className
      )}
      title={isAtLimit && !isAuthenticated && !isFavorited ? "Limite atingido (Login necessário)" : "Favoritar resposta"}
    >
      <Heart
        className={cn(
          "h-4 w-4 transition-all",
          isFavorited 
            ? "text-red-500 fill-red-500 scale-110" 
            : "text-zinc-400 group-hover:text-red-400 group-hover:scale-110"
        )}
      />
    </Button>
  );
}
