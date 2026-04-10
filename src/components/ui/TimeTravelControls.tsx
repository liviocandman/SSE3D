'use client';

import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Calendar,
  RotateCcw,
  Rewind,
  FastForward
} from 'lucide-react';
import { useSolarStore } from '@/store/solarStore';
import { useMissionStore } from '@/store/missionStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useDisplayTime } from '@/hooks/useDisplayTime';

const PLAYBACK_SPEED_OPTIONS = [
  { label: '1x', value: 60, description: '1 min/s' },
  { label: '10x', value: 600, description: '10 min/s' },
  { label: '60x', value: 3600, description: '1 h/s' },
  { label: '360x', value: 21600, description: '6 h/s' },
  { label: '1440x', value: 86400, description: '1 day/s' },
] as const;

/**
 * ClockDisplay - Phase 2 compliant.
 *
 * Reads the throttled display-time snapshot (500ms cadence) via useDisplayTime()
 * instead of subscribing directly to the high-frequency currentTime store field.
 * This prevents the parent React subtree from re-rendering at 60 FPS during
 * active playback.
 */
function ClockDisplay() {
  const displayTime = useDisplayTime(500);

  return (
    <span className="font-mono text-sm tracking-wider">
      {format(displayTime, 'yyyy-MM-dd HH:mm')}
    </span>
  );
}

export function TimeTravelControls() {
  const { 
    currentDate,
    isPlaying, 
    timeMultiplier,
    togglePlaybackIntent,
    stepByMsIntent,
    jumpToDateUtcIntent,
    goLiveIntent,
    resetToAnchorIntent,
    setTimeMultiplier,
  } = useSolarStore(useShallow(s => ({
    currentDate: s.currentDate,
    isPlaying: s.isPlaying,
    timeMultiplier: s.timeMultiplier,
    togglePlaybackIntent: s.togglePlaybackIntent,
    stepByMsIntent: s.stepByMsIntent,
    jumpToDateUtcIntent: s.jumpToDateUtcIntent,
    goLiveIntent: s.goLiveIntent,
    resetToAnchorIntent: s.resetToAnchorIntent,
    setTimeMultiplier: s.setTimeMultiplier,
  })));

  const { isLive, setIsLive, liveTimestamp } = useMissionStore(useShallow(s => ({
    isLive: s.isLive,
    setIsLive: s.setIsLive,
    liveTimestamp: s.liveTimestamp,
  })));

  const [localDate, setLocalDate] = useState(currentDate);

  useEffect(() => {
    setLocalDate(currentDate);
  }, [currentDate]);

  const togglePlay = () => {
    if (isLive) {
      setIsLive(false);
    }
    togglePlaybackIntent();
  };

  const stepTime = (minutes: number) => {
    if (isLive) {
      setIsLive(false);
    }
    stepByMsIntent(minutes * 60000);
  };

  const handleDateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLive) {
      setIsLive(false);
    }
    jumpToDateUtcIntent(localDate);
  };

  const resetTime = () => {
    if (isLive) {
      setIsLive(false);
    }
    resetToAnchorIntent(liveTimestamp ?? undefined);
  };

  const handleGoLive = () => {
    if (liveTimestamp) {
      goLiveIntent(liveTimestamp);
      if (!isLive) {
        setIsLive(true);
      }
    }
  };

  return (
    <div 
      className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3 w-[95%] max-w-md"
      // Stop events from propagating to the 3D OrbitControls (prevent zoom/pan/rotate on HUD)
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      {/* Date Display */}
      <div className="glass-panel px-4 py-2 flex items-center gap-4 text-white/90 animate-in fade-in slide-in-from-bottom-4 relative group">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-blue-400" />
          <ClockDisplay />
        </div>

        <div className="h-4 w-[1px] bg-white/10" />

        <button
          onClick={handleGoLive}
          disabled={!liveTimestamp}
          className={cn(
            "px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all flex items-center gap-1",
            isLive 
              ? "bg-green-500 text-white shadow-[0_0_10px_rgba(34,197,94,0.5)]" 
              : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/80",
            !liveTimestamp && "opacity-50 cursor-not-allowed"
          )}
        >
          <span className={cn("w-1.5 h-1.5 rounded-full bg-current", isLive && "animate-pulse")} />
          Live
        </button>
      </div>

      {/* Main Controls Panel */}
      <div className="glass-panel p-2 flex items-center justify-between w-full shadow-2xl border-white/20 gap-2">
        <button
          onClick={() => stepTime(-15)}
          className="p-3 hover:bg-white/10 rounded-lg transition-colors text-white/40 hover:text-white/80 shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
          title="Back 15m"
        >
          <Rewind className="w-5 h-5 fill-current" />
        </button>

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

        <button
          onClick={() => stepTime(15)}
          className="p-3 hover:bg-white/10 rounded-lg transition-colors text-white/40 hover:text-white/80 shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
          title="Forward 15m"
        >
          <FastForward className="w-5 h-5 fill-current" />
        </button>

        <div className="h-8 w-[1px] bg-white/10 shrink-0" />

        <label className="sr-only" htmlFor="time-multiplier-select">
          Playback speed
        </label>
        <select
          id="time-multiplier-select"
          value={timeMultiplier}
          onChange={(e) => setTimeMultiplier(Number(e.target.value))}
          className="bg-black/40 border border-white/10 rounded px-2 py-2 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors text-white min-w-[84px] shrink-0"
          title="Playback speed"
        >
          {PLAYBACK_SPEED_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} - {option.description}
            </option>
          ))}
        </select>

        <form onSubmit={handleDateSubmit} className="flex flex-1 items-center justify-between gap-2 overflow-hidden">
          <input
            type="date"
            value={localDate}
            onChange={(e) => setLocalDate(e.target.value)}
            // text-base (16px) is required on mobile to avoid zoom on iOS.
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
