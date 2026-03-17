'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAstronomer, AstronomerError } from '@/hooks/useAstronomer';
import type { SelectedPlanet } from '@/lib/types';
import { FavoriteButton } from './FavoriteButton';
import { getSessionItem, setSessionItem, removeSessionItem } from '@/lib/sessionStorage';
import { Trash2 } from 'lucide-react';

interface AstronomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  planet: SelectedPlanet | null;
  currentDate: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// Optimization Constants
const MAX_MESSAGES_PER_PLANET = 20;
const MAX_CACHED_PLANETS = 3;

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AstronomerModal({
  isOpen,
  onClose,
  planet,
  currentDate,
}: AstronomerModalProps) {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { mutateAsync, isPending } = useAstronomer();

  const storageKey = planet ? `sse3d:astronomer:${planet.bodyId}` : null;

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      if (storageKey) {
        const history = getSessionItem<ChatMessage[]>(storageKey, []);
        setMessages(history);
      }
    } else {
      setTimeout(() => {
        setInputValue('');
      }, 300); // clear after close animation
    }
  }, [isOpen, storageKey]);

  useEffect(() => {
    if (!isOpen || !storageKey || messages.length === 0) return;

    // Salvar apenas as N mensagens mais recentes (reduzido de 50 para 20)
    // Benefício: JSON.parse mais rápido ao abrir o modal
    const messagesToSave = messages.slice(-MAX_MESSAGES_PER_PLANET);
    setSessionItem(storageKey, messagesToSave);

    // Limpar planetas mais antigos se houver muitas chaves no sessionStorage
    // Isso evita o crescimento ilimitado do uso de memória da aba
    if (typeof window !== 'undefined') {
      const allKeys = Object.keys(sessionStorage)
        .filter(k => k.startsWith('sse3d:astronomer:'));

      if (allKeys.length > MAX_CACHED_PLANETS) {
        const keysToRemove = allKeys
          .filter(k => k !== storageKey)
          .slice(0, allKeys.length - MAX_CACHED_PLANETS);

        keysToRemove.forEach(key => removeSessionItem(key));
      }
    }
  }, [messages, storageKey, isOpen]);

  const handleClear = () => {
    if (storageKey) {
      removeSessionItem(storageKey);
    }
    setMessages([]);
  };

  const handleSend = async () => {
    if (!planet) {
      toast.error('Selecione um planeta antes de perguntar.');
      return;
    }

    const question = inputValue.trim();
    if (!question || isPending) return;

    setInputValue('');
    setMessages((prev) => [
      ...prev,
      { id: createMessageId(), role: 'user', content: question },
    ]);

    try {
      const response = await mutateAsync({
        bodyId: planet.bodyId,
        date: currentDate,
        question,
      });

      setMessages((prev) => [
        ...prev,
        { id: createMessageId(), role: 'assistant', content: response.answer },
      ]);
    } catch (error) {
      if (error instanceof AstronomerError && error.status === 429) {
        toast.warning('Limite atingido. Aguarde um pouco antes de tentar novamente.');
        return;
      }
      if (error instanceof AstronomerError && error.message) {
        toast.error(error.message);
      } else {
        toast.error('Não foi possível obter resposta da IA.');
      }
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSend();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-white/5 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">Astrônomo Virtual</span>
            <span className="text-sm text-white/80">
              {planet ? `${planet.englishName} • ${currentDate}` : 'Selecione um planeta'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {messages.length > 0 && (
              <button
                onClick={handleClear}
                className="text-white/40 hover:text-red-400 transition-colors flex items-center gap-1"
                title="Limpar Chat"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-white/60 hover:text-white transition-colors text-sm"
              aria-label="Fechar"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col space-y-2 text-center mt-4">
              <div className="text-white/60 text-sm">
                Faça uma pergunta sobre o planeta selecionado. Ex: “Qual a gravidade na superfície?”
              </div>
              <div className="text-white/40 text-xs">
                Histórico temporário (apenas nesta aba). Use a estrela para favoritar e salvar respostas.
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`relative rounded-xl px-4 py-3 text-sm leading-relaxed ${message.role === 'user'
                  ? 'bg-blue-500/20 text-blue-100 border border-blue-500/20 self-end'
                  : 'bg-white/5 text-white/80 border border-white/10 group'
                }`}
            >
              {message.content}
              
              {message.role === 'assistant' && planet && (
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <FavoriteButton 
                    bodyId={planet.bodyId}
                    bodyName={planet.englishName}
                    question={messages.find((m, idx) => messages[idx+1]?.id === message.id)?.content || ''}
                    answer={message.content}
                  />
                </div>
              )}
            </div>
          ))}

          {isPending && (
            <div className="rounded-xl px-4 py-3 text-sm text-white/60 bg-white/5 border border-white/10 animate-pulse">
              Gerando resposta...
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua pergunta..."
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isPending}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${!inputValue.trim() || isPending
                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                : 'bg-blue-500/30 text-blue-100 hover:bg-blue-500/40'
              }`}
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
