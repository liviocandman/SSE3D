import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { Texture, SRGBColorSpace, type WebGLRenderer } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BasisTranscoderError, loadOptionalKTX2Texture } from '@/lib/SingletonKTX2Loader';
import { MoonSurfaceMaterial } from './MoonSurfaceMaterial';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  loadAsync: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock('@react-three/fiber', () => ({ useThree: () => ({}) }));
vi.mock('@/hooks/useTexturePromotion', () => ({ useTexturePromotion: () => null }));
vi.mock('sonner', () => ({ toast: { warning: mocks.warning, dismiss: mocks.dismiss } }));
vi.mock('three-stdlib', () => ({
  KTX2Loader: class {
    init = mocks.init;
    loadAsync = mocks.loadAsync;
    setTranscoderPath() { return this; }
    detectSupport() { return this; }
  },
}));

const IO = { name: 'Io', textureUrl: '/textures/io_high.ktx2', fallbackColor: '#ffff66', meshRef: { current: null }, maxTier: 'high' as const };
const EUROPA = { name: 'Europa', textureUrl: '/textures/europa_high.ktx2', fallbackColor: '#d8d8d8', meshRef: { current: null }, maxTier: 'high' as const };

describe('optional moon surface textures', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.init.mockResolvedValue(undefined);
  });

  it.each([
    ['HTTP 404', new Error('fetch for io_high.ktx2 responded with 404')],
    ['transcode rejection', 'THREE.KTX2Loader: Failed to transcode KTX2 texture.'],
  ])('keeps the solid surface on %s and retries the failed map', async (_, failure) => {
    const ioTexture = new Texture();
    const europaTexture = new Texture();
    const disposeSource = vi.spyOn(ioTexture, 'dispose');
    mocks.loadAsync.mockImplementation((url: string) =>
      url === IO.textureUrl ? Promise.reject(failure) : Promise.resolve(europaTexture));
    const client = new QueryClient();
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const europa = renderHook(() => MoonSurfaceMaterial(EUROPA), { wrapper });
    const io = renderHook(() => MoonSurfaceMaterial(IO), { wrapper });
    const material = () => io.result.current.props;

    await waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1));
    expect(material().map).toBeNull();
    expect(material().color).toBe(IO.fallbackColor);
    expect(io.result.current.key).toBe('solid');
    await waitFor(() => expect(europa.result.current.props.map).toBeInstanceOf(Texture));
    expect(mocks.loadAsync.mock.calls.filter(([url]) => url === IO.textureUrl)).toHaveLength(1);

    const retry = () => {
      const warning = mocks.warning.mock.lastCall?.[1] as { action: { onClick: () => void } };
      act(warning.action.onClick);
    };
    retry();
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(2));
    expect(material().map).toBeNull();
    expect(material().color).toBe(IO.fallbackColor);

    mocks.loadAsync.mockResolvedValueOnce(ioTexture);
    retry();
    await waitFor(() => expect(material().map).toBeInstanceOf(Texture));
    expect(material().map.colorSpace).toBe(SRGBColorSpace);
    expect(material().color).toBe('#ffffff');
    expect(io.result.current.key).toBe('textured');
    expect(mocks.loadAsync.mock.calls.filter(([url]) => url === EUROPA.textureUrl)).toHaveLength(1);
    expect(mocks.loadAsync.mock.lastCall).toEqual([IO.textureUrl]);

    const disposeCopy = vi.spyOn(material().map, 'dispose');
    io.unmount();
    expect(disposeCopy).toHaveBeenCalledOnce();
    expect(disposeSource).not.toHaveBeenCalled();
    const reopened = renderHook(() => MoonSurfaceMaterial(IO), { wrapper });
    expect(reopened.result.current.props.map).toBeInstanceOf(Texture);
    expect(mocks.loadAsync.mock.calls.filter(([url]) => url === IO.textureUrl)).toHaveLength(3);
  });

  it('reports failure to initialize Basis as a shared error', async () => {
    const cause = new Error('Could not load basis_transcoder.wasm');
    mocks.init.mockRejectedValue(cause);

    const failure = await loadOptionalKTX2Texture({} as WebGLRenderer, IO.textureUrl).catch(error => error);

    expect(failure).toBeInstanceOf(BasisTranscoderError);
    expect(failure.cause).toBe(cause);
    expect(mocks.loadAsync).not.toHaveBeenCalled();
  });
});
