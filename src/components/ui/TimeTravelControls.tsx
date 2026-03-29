'use client';

import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Calendar,
  RotateCcw
} from 'lucide-react';
import { useSolarStore } from '@/store/solarStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

function ClockDisplay() {
  const [timeStr, setTimeStr] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const updateTime = () => {
      setTimeStr(format(useSolarStore.getState().currentTime, 'yyyy-MM-dd HH:mm'));
    };
    updateTime(); // Initial update
    const interval = setInterval(updateTime, 500);
    return () => clearInterval(interval);
  }, []);

  if (!mounted) return <span className="font-mono text-sm tracking-wider">Loading...</span>;

  return (
    <span className="font-mono text-sm tracking-wider">
      {timeStr}
    </span>
  );
}

export function TimeTravelControls() {
  const { 
    currentDate, 
    isPlaying, 
    setIsPlaying, 
    setCurrentDate
  } = useSolarStore(useShallow(s => ({
    currentDate: s.currentDate,
    isPlaying: s.isPlaying,
    setIsPlaying: s.setIsPlaying,
    setCurrentDate: s.setCurrentDate,
  })));

  const [localDate, setLocalDate] = useState(currentDate);

  useEffect(() => {
    setLocalDate(currentDate);
  }, [currentDate]);

  const togglePlay = () => setIsPlaying(!isPlaying);

  const handleDateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentDate(localDate);
  };

  const resetTime = () => {
    const today = new Date().toISOString().split('T')[0];
    setCurrentDate(today);
    setIsPlaying(false);
  };

  return (
    <div 
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3 w-[95%] max-w-md"
      // Stop events from propagating to the 3D OrbitControls (prevent zoom/pan/rotate on HUD)
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {/* Date Display */}
      <div className="glass-panel px-4 py-2 flex items-center gap-4 text-white/90 animate-in fade-in slide-in-from-bottom-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-blue-400" />
          <ClockDisplay />
        </div>
      </div>

      {/* Main Controls Panel */}
      <div className="glass-panel p-2 flex items-center justify-between w-full shadow-2xl border-white/20 gap-2">
        <button
          onClick={togglePlay}
          className={cn(
            "p-3 rounded-full transition-all group active:scale-95 shrink-0 min-w-[48px] min-h-[48px] flex items-center justify-center",
            isPlaying ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"
          )}
        >
          {isPlaying ? (
            <Pause className="w-6 h-6 fill-current" />
          ) : (
            <Play className="w-6 h-6 fill-current translate-x-0.5" />
          )}
        </button>

        <div className="h-8 w-[1px] bg-white/10 shrink-0" />

        <form onSubmit={handleDateSubmit} className="flex flex-1 items-center justify-between gap-2 overflow-hidden">
          <input
            type="date"
            value={localDate}
            onChange={(e) => setLocalDate(e.target.value)}
            // text-base (16px) é OBRIGATÓRIO no mobile para evitar zoom no iOS. Em MD pode voltar a text-sm.
            className="bg-black/40 border border-white/10 rounded px-2 py-2 text-base md:text-sm font-mono outline-none focus:border-blue-500/50 transition-colors w-full min-w-[120px]"
          />
          <button 
            type="submit"
            className="text-xs uppercase font-bold tracking-widest text-blue-400 hover:text-white transition-colors px-3 py-2 shrink-0 min-h-[44px]"
          >
            Jump
          </button>
        </form>

        <div className="h-8 w-[1px] bg-white/10 shrink-0" />

        <button
          onClick={resetTime}
          className="p-3 hover:bg-white/10 rounded-lg transition-colors text-white/40 hover:text-white/80 shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
          title="Reset to Today"
        >
          <RotateCcw className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
