import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebGLError } from './useWebGLError';

const loseContext = vi.fn();
const gl = { getExtension: vi.fn(() => ({ loseContext })) };

function appendSceneCanvas() {
  const container = document.createElement('div');
  container.dataset.solarScene = '';
  const canvas = document.createElement('canvas');
  container.append(canvas);
  document.body.append(container);
  return { container, canvas };
}

describe('useWebGLError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      ((name: string) => name === 'webgl2' ? gl : null) as HTMLCanvasElement['getContext'],
    );
  });
  afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); });

  it('requires WebGL 2 even when a WebGL 1 context can be created', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(
      ((name: string) => name === 'webgl' ? gl : null) as HTMLCanvasElement['getContext'],
    );
    const { result } = renderHook(useWebGLError);
    expect(result.current.isSupported).toBe(false);
    expect(result.current.error?.type).toBe('WEBGL_NOT_SUPPORTED');
    expect(loseContext).not.toHaveBeenCalled();
  });

  it('releases the successful capability probe', () => {
    const { result } = renderHook(useWebGLError);
    expect(result.current.isSupported).toBe(true);
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('tracks loss and restoration on the same scene canvas, ignoring unrelated canvases', () => {
    const unrelated = document.createElement('canvas');
    document.body.append(unrelated);
    const { canvas } = appendSceneCanvas();
    const { result } = renderHook(useWebGLError);
    act(() => { unrelated.dispatchEvent(new Event('webglcontextlost', { cancelable: true })); });
    expect(result.current.isContextLost).toBe(false);

    const loss = new Event('webglcontextlost', { cancelable: true });
    act(() => { canvas.dispatchEvent(loss); });
    expect(loss.defaultPrevented).toBe(true);
    expect(canvas.isConnected).toBe(true);
    expect(result.current.error?.type).toBe('WEBGL_CONTEXT_LOST');
    act(() => { canvas.dispatchEvent(new Event('webglcontextrestored')); });
    expect(result.current.isContextLost).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('observes a late canvas and detaches listeners when that canvas is replaced', async () => {
    const { result, unmount } = renderHook(useWebGLError);
    const first = appendSceneCanvas();
    await waitFor(() => {
      const loss = new Event('webglcontextlost', { cancelable: true });
      first.canvas.dispatchEvent(loss);
      expect(loss.defaultPrevented).toBe(true);
    });
    expect(result.current.isContextLost).toBe(true);
    first.container.remove();
    const second = appendSceneCanvas();
    await waitFor(() => expect(result.current.isContextLost).toBe(false));
    const oldLoss = new Event('webglcontextlost', { cancelable: true });
    act(() => { first.canvas.dispatchEvent(oldLoss); });
    expect(oldLoss.defaultPrevented).toBe(false);
    act(() => { second.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })); });
    expect(result.current.isContextLost).toBe(true);
    unmount();
    const detachedLoss = new Event('webglcontextlost', { cancelable: true });
    second.canvas.dispatchEvent(detachedLoss);
    expect(detachedLoss.defaultPrevented).toBe(false);
  });
});
