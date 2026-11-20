'use client';

import { useCallback, useRef, type ReactNode } from 'react';
import { Canvas, type CanvasProps } from '@react-three/fiber';
import { WebGLRenderer } from 'three';
import { useQualityTier } from '@/contexts/QualityTierContext';
import { useSolarStore } from '@/store/solarStore';
import { useShallow } from 'zustand/react/shallow';
import { KM_TO_UNIT } from '@/lib/scales';
import { CameraController } from '@/hooks/useCameraAnimation';
import { SceneEffects } from './SceneEffects';
import { SceneControls } from './SceneControls';
import { GlobalTimeController } from './GlobalTimeController';
import { TrajectoryManager } from './TrajectoryManager';
import { SolarSystemLayer } from './SolarSystemLayer';
import type { EphemerisData } from '@/lib/types';

// --- Constants ---

const CAMERA_CONFIG = {
  position: [0, 200, 500] as [number, number, number],
  fov: 45,
  near: 0.00001,
  far: 50000,
};

// --- Types ---

interface SceneCanvasProps {
  children?: ReactNode;
  ephemerisData?: EphemerisData[];
  onRendererInitializationError: (error: unknown) => void;
}

type RendererFactory = Extract<CanvasProps['gl'], (defaults: never) => Promise<unknown>>;

// --- Component ---

export function SceneCanvas({ children, ephemerisData, onRendererInitializationError }: SceneCanvasProps) {
  const { tier, settings } = useQualityTier();
  const rendererAttempt = useRef<{ canvas: EventTarget; result: Promise<WebGLRenderer> } | null>(null);

  const createRenderer = useCallback<RendererFactory>((defaults) => {
    const { canvas } = defaults;
    // Fiber can configure more than once before its first awaiting call finishes.
    if (rendererAttempt.current?.canvas === canvas) return rendererAttempt.current.result;

    try {
      const renderer = new WebGLRenderer({
        ...defaults,
        canvas: canvas as HTMLCanvasElement,
        logarithmicDepthBuffer: true,
        antialias: settings.antialias,
        powerPreference: tier === 'low' ? 'low-power' : 'high-performance',
      });
      // Fiber configures sRGB output and ACES for the default Canvas color settings.
      const result = Promise.resolve(renderer);
      rendererAttempt.current = { canvas, result };
      return result;
    } catch (error) {
      // Canvas has no rejection handler for configure(). Keep this attempt
      // suspended while the page displays the error and unmounts the Canvas.
      const result = new Promise<never>(() => {});
      rendererAttempt.current = { canvas, result };
      onRendererInitializationError(error);
      return result;
    }
  }, [onRendererInitializationError, settings.antialias, tier]);

  const {
    selectedPlanet,
    setSelectedPlanet,
    travelTarget,
    travelTargetRadius,
    resetTravel,
  } = useSolarStore(
    useShallow((state) => ({
      selectedPlanet: state.selectedPlanet,
      setSelectedPlanet: state.setSelectedPlanet,
      travelTarget: state.travelTarget,
      travelTargetRadius: state.travelTargetRadius,
      resetTravel: state.resetTravel,
    }))
  );

  return (
    <Canvas
      data-solar-scene
      camera={CAMERA_CONFIG}
      dpr={[1, settings.devicePixelRatio]}
      gl={createRenderer}
      style={{ width: '100%', height: '100%' }}
      onPointerMissed={() => {
        setSelectedPlanet(null);
        resetTravel();
      }}
    >
      <SceneEffects tier={tier} />
      <SceneControls />
      <GlobalTimeController />
      <TrajectoryManager />
      <SolarSystemLayer ephemerisData={ephemerisData} />
      <CameraController
        targetPositionKm={travelTarget}
        targetRadiusKm={travelTargetRadius ? travelTargetRadius / KM_TO_UNIT : undefined}
        targetId={selectedPlanet?.bodyId}
      />
      {children}
    </Canvas>
  );
}
