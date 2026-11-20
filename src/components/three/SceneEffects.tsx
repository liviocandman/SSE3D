'use client';

import { Stars } from '@react-three/drei';
import { ContextSafeComposer } from './ContextSafeComposer';
import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import type { Points } from 'three';

function CameraCenteredStars({ tier }: SceneEffectsProps) {
  const points = useRef<Points>(null);
  const camera = useThree(state => state.camera);
  useFrame(() => {
    if (points.current) points.current.position.copy(camera.position);
  });
  return <Stars ref={points} radius={20000} depth={300} count={tier === 'low' ? 2000 : 5000} factor={10} fade speed={0.5} />;
}

interface SceneEffectsProps {
  tier: 'high' | 'mid' | 'low';
}

export function SceneEffects({ tier }: SceneEffectsProps) {
  return (
    <>
      <ambientLight intensity={0.25} color="#b0b0b0" />

      <ContextSafeComposer tier={tier} />
      <CameraCenteredStars tier={tier} />
    </>
  );
}
