/**
 * useLoadingProgress Hook
 * Tracks loading progress across API and texture loading stages
 */

'use client';

import { useSyncExternalStore } from 'react';
import type { LoadingStage, LoadingProgress } from '@/components/ui/LoadingScreen';
import { getTextureReadiness, getEssentialTextureIds, subscribeTextureReadiness } from '@/lib/textureReadiness';

// --- Hook ---

interface UseLoadingProgressOptions {
  isApiLoading: boolean;
  hasApiData: boolean;
  bodyIds?: readonly string[];
}

export function useLoadingProgress({
  isApiLoading,
  hasApiData,
  bodyIds,
}: UseLoadingProgressOptions): LoadingProgress {
  const requiredIds = getEssentialTextureIds(bodyIds);
  const texturesTotal = requiredIds.length;
  const texturesLoaded = useSyncExternalStore(subscribeTextureReadiness, () => getTextureReadiness(requiredIds), () => 0);
  const textureLoadingComplete = texturesLoaded >= texturesTotal;

  // Derive stage from props (no setState in effect needed)
  const stage: LoadingStage = (() => {
    if (hasApiData && textureLoadingComplete) return 'ready';
    if (hasApiData) return 'loading_textures';
    if (isApiLoading) return 'fetching_data';
    return 'initializing';
  })();

  // Calculate progress percentage
  const calculateProgress = (): number => {
    switch (stage) {
      case 'initializing':
        return 5;
      case 'fetching_data':
        return 20;
      case 'loading_textures':
        // 20-95% range for texture loading
        return 20 + (texturesLoaded / texturesTotal) * 75;
      case 'ready':
        return 100;
      default:
        return 0;
    }
  };

  return {
    stage,
    progress: Math.round(calculateProgress()),
    texturesLoaded,
    texturesTotal,
  };
}
