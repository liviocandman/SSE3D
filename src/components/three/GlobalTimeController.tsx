'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useSolarStore } from '@/store/solarStore';
import { clockRuntime } from '@/lib/time/clockRuntime';

const SNAPSHOT_SYNC_INTERVAL_SEC = 0.25;

export function GlobalTimeController() {
  const lastSnapshotSyncSecRef = useRef(0);

  useFrame((state, delta) => {
    const solarStore = useSolarStore.getState();
    const syncSnapshot = solarStore.syncTimeFromRuntime;
    const ensureRuntimeInitialized = solarStore.ensureRuntimeInitialized;
    const tickSimulation = solarStore.tickSimulation;

    if (!clockRuntime.isInitialized()) {
      ensureRuntimeInitialized();
      return;
    }

    const isPlaying = solarStore.isPlaying;
    const auth = solarStore.timeAuthority;
    const canAdvance = isPlaying && auth === 'user';
    if (canAdvance) {
      tickSimulation(delta);
    }

    const runtimeTimeMs = clockRuntime.getTimeMs();
    const storeTimeMs = solarStore.currentTime.getTime();
    const driftMs = Math.abs(runtimeTimeMs - storeTimeMs);
    const elapsedSinceSync = state.clock.elapsedTime - lastSnapshotSyncSecRef.current;
    const shouldSyncNow = !canAdvance || elapsedSinceSync >= SNAPSHOT_SYNC_INTERVAL_SEC;

    if (driftMs > 1 && shouldSyncNow) {
      syncSnapshot(runtimeTimeMs);
      lastSnapshotSyncSecRef.current = state.clock.elapsedTime;
    }
  });
  return null;
}
