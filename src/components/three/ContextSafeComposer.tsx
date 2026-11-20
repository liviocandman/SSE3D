'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { HalfFloatType, NoToneMapping, Vector2, ACESFilmicToneMapping } from 'three';
import {
  BloomEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode,
} from 'postprocessing';

/** Own the passes and render targets without replacing the scene's canvas.
 * postprocessing initializes passes through context attributes, which are null
 * during context loss. Rebuild only after the renderer has restored its context. */
export function ContextSafeComposer({ tier }: { tier: 'high' | 'mid' | 'low' }) {
  const gl = useThree(state => state.gl);
  const get = useThree(state => state.get);
  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  const size = useThree(state => state.size);
  const composerRef = useRef<EffectComposer | null>(null);
  const failedRef = useRef(false);
  const [error, setError] = useState<Error | null>(null);
  if (error) throw error;

  useLayoutEffect(() => {
    // R3F owns this mutable renderer; access it through its imperative store.
    const renderer = get().gl;
    const canvas = renderer.domElement;
    const previousToneMapping = renderer.toneMapping;
    const previousAutoClear = renderer.autoClear;

    const disposeComposer = () => {
      const composer = composerRef.current;
      composerRef.current = null;
      composer?.dispose(); // Disposes passes/targets, never the renderer.
    };
    const buildComposer = () => {
      if (renderer.getContext().isContextLost()) return;
      disposeComposer();
      renderer.toneMapping = ACESFilmicToneMapping;
      if (tier === 'low') return;
      let composer: EffectComposer | null = null;
      try {
        const context = renderer.getContext();
        const hasFloat = context.getExtension('EXT_color_buffer_float')
          || context.getExtension('EXT_color_buffer_half_float');
        if (!hasFloat) return;
        const samples = tier === 'high' ? 4 : 2;
        // Probe the exact RGBA16F multisample combination before the composer allocates it.
        const gl2 = context as WebGL2RenderingContext;
        const supportedSamples = gl2.getInternalformatParameter(gl2.RENDERBUFFER, gl2.RGBA16F, gl2.SAMPLES);
        const multisampling = Array.from(supportedSamples).includes(samples) ? samples : 0;
        composer = new EffectComposer(renderer, {
          multisampling,
          frameBufferType: HalfFloatType,
        });
        composer.addPass(new RenderPass(scene, camera));
        composer.addPass(new EffectPass(camera,
          new BloomEffect({
            intensity: tier === 'high' ? 0.8 : 0.6,
            luminanceThreshold: 1,
            luminanceSmoothing: 0.3,
            mipmapBlur: tier === 'high',
          }),
          new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
        ));
        // Read the current size, including any resize made while context was lost.
        const currentSize = renderer.getSize(new Vector2());
        composer.setSize(currentSize.x, currentSize.y);
        composerRef.current = composer;
        renderer.toneMapping = NoToneMapping;
      } catch {
        composer?.dispose();
        // Keep the scene live and let the renderer apply ACES directly.
        renderer.toneMapping = ACESFilmicToneMapping;
        renderer.autoClear = previousAutoClear;
      }
    };
    const onContextLost = (event: Event) => { event.preventDefault(); disposeComposer(); };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', buildComposer);
    buildComposer();
    return () => {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', buildComposer);
      disposeComposer();
      renderer.toneMapping = previousToneMapping;
      renderer.autoClear = previousAutoClear;
    };
  }, [gl, get, scene, camera, tier]);

  useLayoutEffect(() => {
    if (!gl.getContext().isContextLost()) composerRef.current?.setSize(size.width, size.height);
  }, [gl, size.width, size.height]);

  useFrame(({ gl: renderer }, delta) => {
    if (failedRef.current || renderer.getContext().isContextLost()) return;
    const composer = composerRef.current;
    renderer.toneMapping = composer ? NoToneMapping : ACESFilmicToneMapping;
    const previousAutoClear = renderer.autoClear;
    if (composer) renderer.autoClear = true;
    try {
      if (composer) composer.render(delta);
      else renderer.render(scene, camera);
    } catch (failure) {
      if (!renderer.getContext().isContextLost()) {
        failedRef.current = true;
        setError(failure instanceof Error ? failure : new Error(String(failure)));
      }
    }
    finally { renderer.autoClear = previousAutoClear; }
  }, 1);

  return null;
}
