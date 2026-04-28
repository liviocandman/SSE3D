'use client';

import { Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';

interface SceneEffectsProps {
  tier: 'high' | 'mid' | 'low';
}

export function SceneEffects({ tier }: SceneEffectsProps) {
  return (
    <>
      <ambientLight intensity={0.25} color="#b0b0b0" />

      {tier !== 'low' && (
        <EffectComposer enableNormalPass={false}>
          <Bloom
            intensity={tier === 'high' ? 2.5 : 1.5}
            luminanceThreshold={0.6}
            luminanceSmoothing={0.9}
            mipmapBlur={tier === 'high'}
            color="#ffffffff"
          />
        </EffectComposer>
      )}

      <Stars
        radius={50000}
        depth={300}
        count={tier === 'low' ? 2000 : 5000}
        factor={10}
        fade
        speed={0.5}
      />
    </>
  );
}
