import { act, render, screen } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFrame, useThree, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { ContextSafeComposer } from './ContextSafeComposer';

const { instances } = vi.hoisted(() => ({ instances: [] as {
  dispose: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  options: { multisampling: number; frameBufferType: number };
}[] }));
vi.mock('@react-three/fiber', () => ({ useFrame: vi.fn(), useThree: vi.fn() }));
vi.mock('postprocessing', () => {
  class EffectComposer {
    options;
    constructor(renderer: { autoClear: boolean; getContext: () => { getContextAttributes: () => unknown } }, options: { multisampling: number; frameBufferType: number }) {
      if (!renderer.getContext().getContextAttributes()) throw new Error('Cannot initialize passes on a lost context');
      renderer.autoClear = false;
      this.options = options;
      instances.push(this);
    }
    addPass = vi.fn();
    dispose = vi.fn();
    render = vi.fn();
    setSize = vi.fn();
  }
  return { EffectComposer, RenderPass: class {}, EffectPass: class {}, BloomEffect: class {},
    ToneMappingEffect: class {}, ToneMappingMode: { ACES_FILMIC: 6 } };
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() {
    return this.state.error ? <div data-testid="render-error">{String((this.state.error as Error).message)}</div> : this.props.children;
  }
}

describe('scene render driver recovery', () => {
  let lost: boolean;
  let floatSupported: boolean;
  let supportedSamples: number[];
  let state: RootState;
  let canvas: HTMLCanvasElement;
  let gl: { autoClear: boolean; toneMapping: THREE.ToneMapping; render: ReturnType<typeof vi.fn>; getContext: () => {
    isContextLost: () => boolean; getContextAttributes: () => unknown; getExtension: () => unknown;
    getInternalformatParameter: () => Int32Array; RENDERBUFFER: number; RGBA16F: number; SAMPLES: number;
  }; domElement: HTMLCanvasElement; getSize: (size: THREE.Vector2) => THREE.Vector2; dispose: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    instances.length = 0;
    vi.clearAllMocks();
    lost = false; floatSupported = true; supportedSamples = [4, 2];
    canvas = document.createElement('canvas');
    gl = { autoClear: true, toneMapping: THREE.ACESFilmicToneMapping, render: vi.fn(), domElement: canvas, dispose: vi.fn(),
      getContext: () => ({ isContextLost: () => lost, getContextAttributes: () => lost ? null : { alpha: false },
        getExtension: () => floatSupported ? {} : null, getInternalformatParameter: () => new Int32Array(supportedSamples),
        RENDERBUFFER: 0x8d41, RGBA16F: 0x881a, SAMPLES: 0x8cab }),
      getSize: size => size.set(state.size.width, state.size.height),
    };
    state = { gl, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
      size: { width: 1440, height: 900 }, get: () => state } as unknown as RootState;
    vi.mocked(useThree).mockImplementation(((selector: (state: RootState) => unknown) => selector(state)) as typeof useThree);
  });

  function mount(tier: 'high' | 'mid' | 'low' = 'high') {
    const view = render(<ErrorBoundary><ContextSafeComposer tier={tier} /></ErrorBoundary>);
    const frame = vi.mocked(useFrame).mock.calls.at(-1)![0];
    return { ...view, frame };
  }

  it('suspends the composer during context loss and restores it with current tier and size', () => {
    const view = mount();
    const original = instances[0];
    act(() => { lost = true; canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })); });
    expect(original.dispose).toHaveBeenCalledOnce();
    view.frame(state, 1 / 60);
    expect(original.render).not.toHaveBeenCalled();

    act(() => { lost = false; canvas.dispatchEvent(new Event('webglcontextrestored')); });
    expect(instances).toHaveLength(2);
    view.frame(state, 1 / 60);
    expect(instances[1].render).toHaveBeenCalledOnce();
    view.unmount();
    expect(gl.dispose).not.toHaveBeenCalled();
  });

  it('uses HDR without MSAA when the selected tier sample count is unsupported', () => {
    supportedSamples = [2];
    mount('high');
    expect(instances[0].options.multisampling).toBe(0);
  });

  it('uses direct ACES rendering if the HDR format is unavailable', () => {
    floatSupported = false;
    const view = mount('mid');
    expect(instances).toHaveLength(0);
    expect(gl.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    view.frame(state, 1 / 60);
    expect(gl.render).toHaveBeenCalledOnce();
  });

  it.each(['low', 'high'] as const)('routes a %s direct/frame exception to the boundary once', tier => {
    const view = mount(tier);
    if (tier === 'low') gl.render.mockImplementation(() => { throw new Error('Render interrupted'); });
    else instances[0].render.mockImplementation(() => { throw new Error('Render interrupted'); });
    act(() => { view.frame(state, 1 / 60); });
    expect(screen.getByTestId('render-error').textContent).toBe('Render interrupted');
    view.frame(state, 1 / 60);
    expect(tier === 'low' ? gl.render : instances[0].render).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('does not surface a render exception caused by context loss before restoration', () => {
    const view = mount();
    instances[0].render.mockImplementation(() => { lost = true; throw new Error('Context lost during render'); });
    act(() => { view.frame(state, 1 / 60); });
    expect(screen.queryByTestId('render-error')).toBeNull();
    act(() => { canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })); });
    lost = false;
    act(() => { canvas.dispatchEvent(new Event('webglcontextrestored')); });
    expect(instances).toHaveLength(2);
    view.unmount();
  });
});
