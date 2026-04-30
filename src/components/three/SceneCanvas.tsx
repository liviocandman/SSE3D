'use client';

import { ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { useQualityTier } from '@/contexts/QualityTierContext';
import { useSolarStore } from '@/store/solarStore';
import { useMissionStore } from '@/store/missionStore';
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
}

// --- Component ---

export function SceneCanvas({ children, ephemerisData }: SceneCanvasProps) {
  const { tier, settings } = useQualityTier();

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

  const { selectedMissionTargetId, setSelectedMissionTargetId } = useMissionStore(
    useShallow((state) => ({
      selectedMissionTargetId: state.selectedMissionTargetId,
      setSelectedMissionTargetId: state.setSelectedMissionTargetId,
    }))
  );

  const isEarthMissionContextActive = selectedPlanet?.bodyId === '399';

  const cameraTargetId =
    selectedMissionTargetId ||
    selectedPlanet?.bodyId ||
    (isEarthMissionContextActive ? 'Orion' : undefined);

  return (
    <Canvas
      camera={CAMERA_CONFIG}
      dpr={[1, settings.devicePixelRatio]}
      gl={{
        logarithmicDepthBuffer: true,
        antialias: settings.antialias,
        powerPreference: tier === 'low' ? 'low-power' : 'high-performance',
      }}
      style={{ width: '100%', height: '100%' }}
      onPointerMissed={() => {
        setSelectedPlanet(null);
        setSelectedMissionTargetId(null);
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
        targetId={cameraTargetId}
      />
      {children}
    </Canvas>
  );
}
