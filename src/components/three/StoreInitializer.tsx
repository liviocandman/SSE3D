"use client";

import { useRef } from 'react';
import { useSolarStore } from '@/store/solarStore';
import type { EphemerisData } from '@/lib/types';

interface StoreInitializerProps {
  initialFullOrbits: EphemerisData[];
  initialTrajectoryData?: EphemerisData[];
}

/**
 * Synchronous store initializer for Next.js App Router.
 * Injects server-fetched data into Zustand during the first render pass
 * before the browser paint, eliminating the "pop-in" effect.
 */
export function StoreInitializer({ initialFullOrbits, initialTrajectoryData }: StoreInitializerProps) {
  const initialized = useRef(false);

  // Synchronous injection: runs during the render phase
  if (!initialized.current) {
    if (initialFullOrbits && initialFullOrbits.length > 0) {
      useSolarStore.getState().appendFullOrbits(initialFullOrbits);
    }
    
    if (initialTrajectoryData && initialTrajectoryData.length > 0) {
      useSolarStore.getState().appendTrajectoryData(initialTrajectoryData);
    }

    initialized.current = true;
  }

  return null;
}
