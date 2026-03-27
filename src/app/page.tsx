'use client';

import { useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Toaster, toast } from 'sonner';
import { useEphemeris } from '@/hooks/useEphemeris';
import { useLoadingProgress } from '@/hooks/useLoadingProgress';
import { useWebGLError } from '@/hooks/useWebGLError';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { ErrorOverlay } from '@/components/ui/ErrorOverlay';
import { HUD } from '@/components/ui/HUD';
import { useSessionMerge } from '@/hooks/useSessionMerge';
import { BODY_IDS } from '@/lib/types';
import { scalePositionFromKm } from '@/lib/scales';
import type { AppError } from '@/components/ui/ErrorOverlay';
import { useSolarStore } from '@/store/solarStore';

// Dynamically import SceneManager with SSR disabled
// This prevents hydration mismatch errors with Three.js/R3F
const SceneManager = dynamic(
  () => import('@/components/three/SceneManager').then(mod => mod.SceneManager),
  { ssr: false }
);

// --- Date Utilities ---

function isValidDate(dateString: string): boolean {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return false;

  // JPL Horizons limits: 1600-01-01 to 2500-01-01
  const minDate = new Date('1600-01-01');
  const maxDate = new Date('2500-01-01');

  return date >= minDate && date <= maxDate;
}

// --- Component ---

export default function Home() {
  const currentDate = useSolarStore((state) => state.currentDate);
  const trajectoryBaseDate = useSolarStore((state) => state.trajectoryBaseDate);
  const setCurrentDate = useSolarStore((state) => state.setCurrentDate);

  // Trigger data merge if user just logged in
  useSessionMerge();

  // Use the useEphemeris hook for data fetching with error handling
  const {
    data: ephemerisData,
    isLoading,
    error: ephemerisError,
    source,
    isFallback,
    retry,
    retryCount,
    refresh
  } = useEphemeris({ date: trajectoryBaseDate, spanDays: 30 });

  // WebGL error detection
  const {
    error: webglError,
    isSupported: isWebGLSupported,
    isContextLost: isWebGLContextLost,
  } = useWebGLError();

  // Track loading progress
  const loadingProgress = useLoadingProgress({
    isApiLoading: isLoading,
    hasApiData: ephemerisData.length > 0,
  });

  // Get Earth position for distance calculations
  const earthPosition = useMemo(() => {
    const earth = ephemerisData.find(body => body.bodyId === BODY_IDS.EARTH);
    if (earth) {
      const scaledEarth = scalePositionFromKm(earth.position.x, earth.position.y, earth.position.z);
      return {
        x: scaledEarth[0],
        y: scaledEarth[1],
        z: scaledEarth[2],
      };
    }
    return undefined;
  }, [ephemerisData]);

  // Combine errors - WebGL errors take priority
  const activeError: AppError | null = webglError ?? (ephemerisError ? {
    type: ephemerisError.type,
    message: ephemerisError.message,
    technicalDetails: ephemerisError.technicalDetails,
    canRetry: ephemerisError.canRetry,
  } : null);

  // Only show error overlay for critical errors (not when fallback is working)
  const isWebGLError = activeError?.type === 'WEBGL_NOT_SUPPORTED'
    || activeError?.type === 'WEBGL_CONTEXT_LOST';
  const showErrorOverlay = !!activeError && (isWebGLError || !isFallback);

  // Handle date change with validation
  const handleDateChange = (newDate: string) => {
    if (!isValidDate(newDate)) {
      toast.error('Data inválida', {
        description: 'A data deve estar entre 1600 e 2500.',
      });
      return;
    }

    setCurrentDate(newDate);

    console.log(`[Home] Date changed to: ${newDate}`);
  };

  // Show toast notifications based on data source
  useEffect(() => {
    if (isLoading || !source) return;

    if (source === 'FALLBACK_DATASET') {
      toast.warning('Modo Offline: Posições aproximadas', {
        description: 'Usando dados de fallback. API NASA indisponível.',
        duration: 5000,
      });
    } else if (source === 'CACHE_HIT') {
      toast.success('Dados carregados do cache', {
        duration: 2000,
      });
    } else if (source === 'NASA_LIVE') {
      toast.success('Dados ao vivo da NASA', {
        duration: 2000,
      });
    }

    console.log(`[Home] Ephemeris loaded - Source: ${source}, Bodies: ${ephemerisData.length}, Date: ${currentDate}`);
  }, [source, isLoading, ephemerisData.length, currentDate]);

  // Show loading screen while loading
  const showLoadingScreen = loadingProgress.stage !== 'ready' && !showErrorOverlay;

  return (
    <>
      <Toaster
        position="top-right"
        richColors
        theme="dark"
        toastOptions={{
          style: {
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          },
        }}
      />

      {/* Error overlay for critical errors */}
      {showErrorOverlay && activeError && (
        <ErrorOverlay
          error={activeError}
          onRetry={retry}
          retryCount={retryCount}
          maxRetries={3}
          isFallbackActive={isFallback}
        />
      )}

      {/* Loading screen with progress */}
      {showLoadingScreen && (
        <LoadingScreen progress={loadingProgress} />
      )}

      {/* Scene (renders behind loading screen during load) */}
      {isWebGLSupported && !isWebGLContextLost && !isWebGLError && (
        <SceneManager
          ephemerisData={ephemerisData}
        />
      )}

      {/* HUD - Responsive sidebar (desktop) / bottom sheet (mobile) */}
      {!showLoadingScreen && !showErrorOverlay && (
        <HUD
          earthPosition={earthPosition}
          onDateChange={handleDateChange}
          onRefresh={refresh}
          isFallback={isFallback}
        />
      )}
    </>
  );
}
