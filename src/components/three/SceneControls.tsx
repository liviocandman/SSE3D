'use client';

import { OrbitControls } from '@react-three/drei';

export function SceneControls() {
  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.05}
      minDistance={0.00001}
      maxDistance={50000}
      enablePan={false}
      panSpeed={1}
      rotateSpeed={1}
      zoomSpeed={3}
    />
  );
}
