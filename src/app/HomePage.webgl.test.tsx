import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';

const sceneMode = vi.hoisted(() => ({ realCanvas: false, failedTexture: false }));

vi.mock('next/dynamic', async () => {
  const { SceneManager } = await import('@/components/three/SceneManager');
  const { SceneErrorBoundary } = await import('@/components/three/SceneErrorBoundary');
  function BrokenTexture(): never {
    throw new Error('Could not load the essential Earth texture');
  }
  return {
    default: () => function TestScene(props: React.ComponentProps<typeof SceneManager>) {
      if (sceneMode.failedTexture) {
        return <SceneErrorBoundary onError={props.onSceneError}><BrokenTexture /></SceneErrorBoundary>;
      }
      return sceneMode.realCanvas
        ? <SceneManager {...props} />
        : <div data-solar-scene><canvas data-testid="scene-canvas" /></div>;
    },
  };
});
vi.mock('@/hooks/useEphemeris', () => ({
  useEphemeris: () => ({
    data: [], isLoading: false, error: null, source: null, isFallback: sceneMode.realCanvas,
  }),
}));
vi.mock('@/hooks/useLoadingProgress', () => ({
  useLoadingProgress: () => sceneMode.realCanvas
    ? { stage: 'loading_textures', progress: 40 }
    : { stage: 'ready' },
}));
vi.mock('@/hooks/useSessionMerge', () => ({ useSessionMerge: () => {} }));
vi.mock('@/components/three/StoreInitializer', () => ({ StoreInitializer: () => null }));
vi.mock('@/components/three/SceneEffects', () => ({ SceneEffects: () => null }));
vi.mock('@/components/three/SceneControls', () => ({ SceneControls: () => null }));
vi.mock('@/components/three/GlobalTimeController', () => ({ GlobalTimeController: () => null }));
vi.mock('@/components/three/TrajectoryManager', () => ({ TrajectoryManager: () => null }));
vi.mock('@/components/three/SolarSystemLayer', () => ({ SolarSystemLayer: () => null }));
vi.mock('@/hooks/useCameraAnimation', () => ({ CameraController: () => null }));
vi.mock('@/components/ui/HUD', () => ({ HUD: () => null }));
vi.mock('sonner', () => ({ Toaster: () => null, toast: { dismiss: () => {} } }));
vi.mock('@/store/solarStore', () => ({
  useSolarStore: (selector: (state: unknown) => unknown) => selector({
    currentDate: '2026-11-14', trajectoryBaseDate: '2026-11-14', setCurrentDate: () => {},
    setSelectedPlanet: () => {}, resetTravel: () => {},
  }),
}));

describe('HomePage WebGL recovery', () => {
  afterEach(() => {
    sceneMode.realCanvas = false;
    sceneMode.failedTexture = false;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retains the actual canvas during context loss and clears the error when it restores', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (() => ({ getExtension: () => null })) as unknown as HTMLCanvasElement['getContext'],
    );
    render(<HomePage initialFullOrbits={[]} />);
    const canvas = screen.getByTestId('scene-canvas');
    act(() => { canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })); });
    expect(screen.getByRole('heading', { name: 'Graphics Context Lost' })).toBeVisible();
    expect(screen.getByTestId('scene-canvas')).toBe(canvas);
    expect(canvas.isConnected).toBe(true);

    act(() => { canvas.dispatchEvent(new Event('webglcontextrestored')); });
    expect(screen.queryByRole('heading', { name: 'Graphics Context Lost' })).not.toBeInTheDocument();
    expect(screen.getByTestId('scene-canvas')).toBe(canvas);
  });

  it('shows recovery once when the scene context is refused after the support probe succeeds', async () => {
    sceneMode.realCanvas = true;
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const requestRendererContext = vi.fn();
    const requestProbeContext = vi.fn(() => ({ getExtension: () => null }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((function (
      this: HTMLCanvasElement, contextId: string, options?: WebGLContextAttributes,
    ) {
      if (this.closest('[data-solar-scene]')) {
        requestRendererContext(contextId, options);
        return null;
      }
      return requestProbeContext();
    }) as HTMLCanvasElement['getContext']);

    const { rerender } = render(<HomePage initialFullOrbits={[]} />);
    expect(screen.getByText('Loading planet textures...')).toBeVisible();
    expect(requestProbeContext).toHaveBeenCalled();
    act(() => { window.dispatchEvent(new Event('resize')); });

    expect(await screen.findByRole('heading', { name: '3D Scene Unavailable' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Manual Refresh' })).toBeEnabled();
    expect(screen.getByText('Error creating WebGL context.')).toBeVisible();
    expect(screen.queryByText('Loading planet textures...')).not.toBeInTheDocument();
    expect(document.querySelector('[data-solar-scene] canvas')).toBeNull();

    rerender(<HomePage initialFullOrbits={[]} />);
    act(() => { window.dispatchEvent(new Event('resize')); });
    // Three.js makes a second call without attributes to diagnose the first refusal.
    expect(requestRendererContext).toHaveBeenCalledTimes(2);
    expect(requestRendererContext).toHaveBeenNthCalledWith(1, 'webgl2', expect.objectContaining({
      antialias: true, alpha: true,
    }));
  });

  it('replaces initial loading with the essential texture error even with degraded ephemerides', async () => {
    sceneMode.realCanvas = true;
    sceneMode.failedTexture = true;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (() => ({ getExtension: () => null })) as unknown as HTMLCanvasElement['getContext'],
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<HomePage initialFullOrbits={[]} />);

    expect(await screen.findByRole('heading', { name: 'Texture Load Error' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Manual Refresh' })).toBeEnabled();
    expect(screen.queryByText('Loading planet textures...')).not.toBeInTheDocument();
  });
});
