'use client';

import { Suspense, ReactNode } from 'react';
import { QualityTierProvider } from '@/contexts/QualityTierContext';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import type { AppError } from '@/components/ui/ErrorOverlay';
import { SceneCanvas } from './SceneCanvas';
import { SceneErrorBoundary } from './SceneErrorBoundary';
import type { EphemerisData } from '@/lib/types';

interface SceneManagerProps {
  children?: ReactNode;
  ephemerisData?: EphemerisData[];
  onRendererInitializationError: (error: unknown) => void;
  onSceneError?: (error: AppError) => void;
}

export function SceneManager({
  children,
  ephemerisData,
  onRendererInitializationError,
  onSceneError,
}: SceneManagerProps) {
  return (
    <QualityTierProvider>
      <div className="fixed inset-0 overflow-hidden bg-[#000]">
        <SceneErrorBoundary onError={onSceneError}>
          <Suspense fallback={<LoadingScreen />}>
            <SceneCanvas
              ephemerisData={ephemerisData}
              onRendererInitializationError={onRendererInitializationError}
            >
              {children}
            </SceneCanvas>
          </Suspense>
        </SceneErrorBoundary>
      </div>
    </QualityTierProvider>
  );
}
