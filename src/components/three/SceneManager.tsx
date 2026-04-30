'use client';

import { Suspense, ReactNode } from 'react';
import { QualityTierProvider } from '@/contexts/QualityTierContext';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { SceneCanvas } from './SceneCanvas';
import type { EphemerisData } from '@/lib/types';

interface SceneManagerProps {
  children?: ReactNode;
  ephemerisData?: EphemerisData[];
}

export function SceneManager({
  children,
  ephemerisData,
}: SceneManagerProps) {
  return (
    <QualityTierProvider>
      <div className="fixed inset-0 overflow-hidden bg-[#000]">
        <Suspense fallback={<LoadingScreen />}>
          <SceneCanvas ephemerisData={ephemerisData}>
            {children}
          </SceneCanvas>
        </Suspense>
      </div>
    </QualityTierProvider>
  );
}
