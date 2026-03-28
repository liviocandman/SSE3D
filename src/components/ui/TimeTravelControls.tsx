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

export function TimeTravelControls() {
  const { 
    currentDate, 
    currentTime,
    isPlaying, 
    setIsPlaying, 
    setCurrentDate
  } = useSolarStore(useShallow(s => ({
    currentDate: s.currentDate,
    currentTime: s.currentTime,
    isPlaying: s.isPlaying,
    setIsPlaying: s.setIsPlaying,
    setCurrentDate: s.setCurrentDate,
  })));

  const [localDate, setLocalDate] = useState(currentDate);

  // Sync localDate with store, but allow user to type
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
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3">
      {/* Date Display */}
      <div className="glass-panel px-4 py-2 flex items-center gap-4 text-white/90 animate-in fade-in slide-in-from-bottom-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-blue-400" />
          <span className="font-mono text-sm tracking-wider">
            {format(currentTime, 'yyyy-MM-dd HH:mm')}
          </span>
        </div>
      </div>

      {/* Main Controls Panel */}
      <div className="glass-panel p-2 flex items-center gap-1 shadow-2xl border-white/20">
        <button
          onClick={togglePlay}
          className={cn(
            "p-3 rounded-full transition-all group active:scale-95",
            isPlaying ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"
          )}
        >
          {isPlaying ? (
            <Pause className="w-6 h-6 fill-current" />
          ) : (
            <Play className="w-6 h-6 fill-current translate-x-0.5" />
          )}
        </button>

        <div className="h-6 w-[1px] bg-white/10 mx-1" />

        <form onSubmit={handleDateSubmit} className="flex items-center gap-2 ml-2 pr-1">
          <input
            type="date"
            value={localDate}
            onChange={(e) => setLocalDate(e.target.value)}
            className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors w-32"
          />
          <button 
            type="submit"
            className="text-[10px] uppercase font-bold tracking-widest text-blue-400 hover:text-white transition-colors px-2"
          >
            Jump
          </button>
        </form>

        <div className="h-6 w-[1px] bg-white/10 mx-1" />

        <button
          onClick={resetTime}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/40 hover:text-white/80"
          title="Reset to Today"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
