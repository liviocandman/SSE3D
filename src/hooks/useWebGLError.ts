'use client';

import { useState, useEffect } from 'react';
import type { AppError } from '@/components/ui/ErrorOverlay';

interface UseWebGLErrorReturn {
  error: AppError | null;
  isSupported: boolean;
  isContextLost: boolean;
}

const SCENE_CANVAS_SELECTOR = '[data-solar-scene] canvas';

/** Match the WebGL 2 requirement of the installed Three.js renderer. */
function checkWebGLSupport(): { supported: boolean; error: AppError | null } {
  if (typeof window === 'undefined') return { supported: true, error: null };

  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('No WebGL 2 context could be created.');
    return { supported: true, error: null };
  } catch (error) {
    return {
      supported: false,
      error: {
        type: 'WEBGL_NOT_SUPPORTED',
        message: 'WebGL 2 is not available in this browser',
        technicalDetails: error instanceof Error ? error.message : 'WebGL 2 detection failed.',
        canRetry: false,
      },
    };
  } finally {
    // The probe must not retain a second GPU context for the lifetime of the page.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export function useWebGLError(): UseWebGLErrorReturn {
  const [webglCheck] = useState(checkWebGLSupport);
  const [contextError, setContextError] = useState<AppError | null>(null);
  const [isContextLost, setIsContextLost] = useState(false);

  useEffect(() => {
    if (!webglCheck.supported) return;
    let canvas: HTMLCanvasElement | null = null;

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setIsContextLost(true);
      setContextError({
        type: 'WEBGL_CONTEXT_LOST',
        message: 'WebGL context was lost',
        technicalDetails: 'Waiting for the graphics context to be restored. Reload the page if it does not recover.',
        canRetry: false,
      });
    };
    const handleContextRestored = () => {
      setIsContextLost(false);
      setContextError(null);
    };
    const detach = () => {
      canvas?.removeEventListener('webglcontextlost', handleContextLost);
      canvas?.removeEventListener('webglcontextrestored', handleContextRestored);
    };
    const observeSceneCanvas = () => {
      const next = document.querySelector<HTMLCanvasElement>(SCENE_CANVAS_SELECTOR);
      if (next === canvas) return;
      detach();
      canvas = next;
      if (canvas) {
        canvas.addEventListener('webglcontextlost', handleContextLost);
        canvas.addEventListener('webglcontextrestored', handleContextRestored);
        handleContextRestored();
      }
    };

    observeSceneCanvas();
    const observer = new MutationObserver(observeSceneCanvas);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); detach(); };
  }, [webglCheck.supported]);

  return {
    error: webglCheck.error ?? contextError,
    isSupported: webglCheck.supported,
    isContextLost,
  };
}
