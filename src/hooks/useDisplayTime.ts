'use client';

/**
 * useDisplayTime
 *
 * Phase 2 - Protect the UI from 60 FPS clock churn.
 *
 * Provides a throttled snapshot of the simulation clock that is safe for React
 * DOM components to subscribe to. This hook samples `currentTime` from the
 * solarStore at a fixed interval (default 500ms) instead of re-rendering every
 * animation frame.
 *
 * It uses a singleton interval to ensure we don't spawn a unique interval
 * for every HUD widget that mounts. All subscribers get the same batch update.
 */

import { useState, useEffect } from 'react';
import { useSolarStore } from '@/store/solarStore';

type TimerListener = (time: Date) => void;
interface SharedDisplayClock {
  intervalId: NodeJS.Timeout | null;
  listeners: Set<TimerListener>;
  lastTime: Date | null;
}

const sharedClocks = new Map<number, SharedDisplayClock>();

function getSharedClock(intervalMs: number): SharedDisplayClock {
  const existing = sharedClocks.get(intervalMs);
  if (existing) return existing;

  const created: SharedDisplayClock = {
    intervalId: null,
    listeners: new Set<TimerListener>(),
    lastTime: null,
  };
  sharedClocks.set(intervalMs, created);
  return created;
}

function startSharedTimer(intervalMs: number) {
  const clock = getSharedClock(intervalMs);
  if (clock.intervalId !== null) return;

  clock.lastTime = useSolarStore.getState().currentTime;
  clock.intervalId = setInterval(() => {
    clock.lastTime = useSolarStore.getState().currentTime;
    clock.listeners.forEach((listener) => listener(clock.lastTime!));
  }, intervalMs);
}

function stopSharedTimer(intervalMs: number) {
  const clock = sharedClocks.get(intervalMs);
  if (!clock) return;

  if (clock.intervalId !== null && clock.listeners.size === 0) {
    clearInterval(clock.intervalId);
    sharedClocks.delete(intervalMs);
  }
}

/**
 * Returns a throttled snapshot of the simulation clock.
 *
 * @param intervalMs - How often to sample the store (default 500ms).
 *                     Each interval value gets its own shared singleton timer.
 * @returns A Date that updates at most once per intervalMs.
 */
export function useDisplayTime(intervalMs = 500): Date {
  const clock = getSharedClock(intervalMs);
  const [displayTime, setDisplayTime] = useState<Date>(() => 
    clock.lastTime || useSolarStore.getState().currentTime
  );

  useEffect(() => {
    const currentClock = getSharedClock(intervalMs);
    currentClock.listeners.add(setDisplayTime);
    
    // Immediately sync to the latest store time in case things changed before mount.
    setDisplayTime(useSolarStore.getState().currentTime);
    
    startSharedTimer(intervalMs);

    return () => {
      currentClock.listeners.delete(setDisplayTime);
      stopSharedTimer(intervalMs);
    };
  }, [intervalMs]);

  return displayTime;
}
