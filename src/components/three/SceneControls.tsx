'use client';

import { OrbitControls } from '@react-three/drei';
import { useSolarStore } from '@/store/solarStore';
import { CAMERA_CONFIG, getBodyCameraFraming } from '@/lib/cameraConfig';
import { useShallow } from 'zustand/react/shallow';

export function SceneControls() {
  const { bodyId, viewMode } = useSolarStore(useShallow(state => ({
    bodyId: state.cameraFocusBodyId,
    viewMode: state.viewMode,
  })));
  // The origin retains its body after tracking stops, even if the HUD selects another body.
  const minDistance = bodyId
    ? getBodyCameraFraming(bodyId, viewMode)?.minDistance ?? CAMERA_CONFIG.MIN_FOCUS_OFFSET
    : CAMERA_CONFIG.MIN_FOCUS_OFFSET;
  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.05}
      minDistance={minDistance}
      maxDistance={CAMERA_CONFIG.MAX_DISTANCE}
      enablePan={false}
      panSpeed={1}
      rotateSpeed={1}
      zoomSpeed={3}
    />
  );
}
