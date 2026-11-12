'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Toaster, toast } from 'sonner';
import { useEphemeris } from '@/hooks/useEphemeris';
import { useLoadingProgress } from '@/hooks/useLoadingProgress';
import { useWebGLError } from '@/hooks/useWebGLError';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { ErrorOverlay } from '@/components/ui/ErrorOverlay';
import { HUD } from '@/components/ui/HUD';
import { useSessionMerge } from '@/hooks/useSessionMerge';
import type { EphemerisData } from '@/lib/types';
import type { AppError } from '@/components/ui/ErrorOverlay';
import { useSolarStore } from '@/store/solarStore';
import { StoreInitializer } from '@/components/three/StoreInitializer';
import { DEGRADED_EPHEMERIS_MESSAGE } from '@/lib/ephemerisStatus';

// Dynamically import SceneManager with SSR disabled
const SceneManager = dynamic(
  () => import('@/components/three/SceneManager').then(mod => mod.SceneManager),
  { ssr: false }
);

interface HomePageProps {
  initialFullOrbits: EphemerisData[];
  initialTrajectoryData?: EphemerisData[];
}

export function HomePage({ initialFullOrbits, initialTrajectoryData = [] }: HomePageProps) {
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

  const activeError: AppError | null = webglError ?? (ephemerisError ? {
    type: ephemerisError.type,
    message: ephemerisError.message,
    technicalDetails: ephemerisError.technicalDetails,
    canRetry: ephemerisError.canRetry,
  } : null);

  const isWebGLError = activeError?.type === 'WEBGL_NOT_SUPPORTED'
    || activeError?.type === 'WEBGL_CONTEXT_LOST';
  const showErrorOverlay = !!activeError && (isWebGLError || !isFallback);

  const handleDateChange = (newDate: string) => {
    setCurrentDate(newDate);
    console.log(`[HomePage] Date changed to: ${newDate}`);
  };

  useEffect(() => {
    if (!isFallback) toast.dismiss('degraded-ephemeris');
    if (isLoading || !source) return;

    if (isFallback) {
      toast.warning('Dados degradados', {
        id: 'degraded-ephemeris',
        description: DEGRADED_EPHEMERIS_MESSAGE,
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

    console.log(`[HomePage] Ephemeris loaded - Source: ${source}, Bodies: ${ephemerisData.length}, Date: ${currentDate}`);
  }, [source, isFallback, isLoading, ephemerisData.length, currentDate]);

  const showLoadingScreen = loadingProgress.stage !== 'ready' && !showErrorOverlay;

  return (
    <>
      {/* 1. Synchronous hydration runs first during initial render pass */}
      <StoreInitializer 
        initialFullOrbits={initialFullOrbits} 
        initialTrajectoryData={initialTrajectoryData}
      />

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

      {showErrorOverlay && activeError && (
        <ErrorOverlay
          error={activeError}
          onRetry={retry}
          retryCount={retryCount}
          maxRetries={3}
          isFallbackActive={isFallback}
        />
      )}

      {showLoadingScreen && (
        <LoadingScreen progress={loadingProgress} />
      )}

      {isWebGLSupported && !isWebGLContextLost && !isWebGLError && (
        <SceneManager
          ephemerisData={ephemerisData}
        />
      )}

      {!showLoadingScreen && !showErrorOverlay && (
        <HUD
          onDateChange={handleDateChange}
          onRefresh={refresh}
          isFallback={isFallback}
        />
      )}
    </>
  );
}
