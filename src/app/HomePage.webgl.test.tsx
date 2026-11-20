import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';

vi.mock('next/dynamic', async () => {
  const { SceneManager } = await import('@/components/three/SceneManager');
  return {
    default: () => function TestScene(props: React.ComponentProps<typeof SceneManager>) {
      return <SceneManager {...props} />;
    },
  };
});
vi.mock('@/hooks/useEphemeris', () => ({
  useEphemeris: () => ({
    data: [], isLoading: false, error: null, source: null, isFallback: true,
  }),
}));
vi.mock('@/hooks/useLoadingProgress', () => ({
  useLoadingProgress: () => ({ stage: 'loading_textures', progress: 40 }),
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows recovery once when the scene context is refused after the support probe succeeds', async () => {
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
});
