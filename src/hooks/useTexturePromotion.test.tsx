import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { useFrame, useThree, type RootState } from '@react-three/fiber';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTexturePromotion } from './useTexturePromotion';
import { loadOptionalKTX2Texture } from '@/lib/SingletonKTX2Loader';

vi.mock('@react-three/fiber', () => ({ useFrame: vi.fn(), useThree: vi.fn() }));
vi.mock('@/lib/SingletonKTX2Loader', () => ({ loadOptionalKTX2Texture: vi.fn() }));

describe('projected texture promotion', () => {
  let camera: THREE.PerspectiveCamera;
  let mesh: THREE.Mesh;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 0);
    mesh = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshStandardMaterial({ map: new THREE.Texture() }));
    mesh.position.z = -10;
    mesh.scale.setScalar(1);
    mesh.updateMatrixWorld(true);
    const state = { camera, gl: {}, size: { width: 1000, height: 1000 } } as RootState;
    vi.mocked(useThree).mockImplementation(((selector?: (state: RootState) => unknown) =>
      selector ? selector(state) : state) as typeof useThree);
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

  it('requests mid only after the projected size crosses its threshold and leaves low on failure', async () => {
    vi.mocked(loadOptionalKTX2Texture).mockRejectedValue(new Error('404'));
    const { result } = renderHook(() => useTexturePromotion({ current: mesh }, '/earth_low.ktx2', 'high'), { wrapper });
    const frame = vi.mocked(useFrame).mock.calls[0][0];
    act(() => { for (let i = 0; i < 12; i++) frame({} as RootState, 1 / 60); });
    await waitFor(() => expect(loadOptionalKTX2Texture).toHaveBeenCalledWith({}, '/earth_mid.ktx2'));
    await waitFor(() => expect(queryClient.getQueryState(['optional-planet-texture', '/earth_mid.ktx2'])?.status).toBe('error'));
    expect(result.current).toBeNull();
  });

  it('requests the high tier for a large projection and applies an owned clone after loading', async () => {
    const decoded = new THREE.Texture();
    vi.mocked(loadOptionalKTX2Texture).mockResolvedValue(decoded);
    mesh.position.z = -2;
    mesh.updateMatrixWorld(true);
    const { result, unmount } = renderHook(() => useTexturePromotion({ current: mesh }, '/earth_low.ktx2', 'high'), { wrapper });
    const frame = vi.mocked(useFrame).mock.calls.at(-1)![0];
    act(() => { for (let i = 0; i < 12; i++) frame({} as RootState, 1 / 60); });
    await waitFor(() => expect(loadOptionalKTX2Texture).toHaveBeenCalledWith({}, '/earth_high.ktx2'));
    await waitFor(() => expect(result.current).toBeInstanceOf(THREE.Texture));
    expect(result.current).not.toBe(decoded);
    const disposed = vi.fn();
    result.current!.addEventListener('dispose', disposed);
    unmount();
    await waitFor(() => expect(disposed).toHaveBeenCalledTimes(1));
  });

  it('does not request maps above the device tier cap', async () => {
    mesh.position.z = -2;
    mesh.updateMatrixWorld(true);
    renderHook(() => useTexturePromotion({ current: mesh }, '/earth_low.ktx2', 'mid'), { wrapper });
    const frame = vi.mocked(useFrame).mock.calls.at(-1)![0];
    act(() => { for (let i = 0; i < 12; i++) frame({} as RootState, 1 / 60); });
    await waitFor(() => expect(loadOptionalKTX2Texture).toHaveBeenCalledWith({}, '/earth_mid.ktx2'));
  });

  it('does not request a larger map for an off-screen body', () => {
    mesh.position.set(1000, 0, -2);
    mesh.updateMatrixWorld(true);
    renderHook(() => useTexturePromotion({ current: mesh }, '/earth_low.ktx2', 'high'), { wrapper });
    const frame = vi.mocked(useFrame).mock.calls.at(-1)![0];
    act(() => { for (let i = 0; i < 12; i++) frame({} as RootState, 1 / 60); });
    expect(loadOptionalKTX2Texture).not.toHaveBeenCalled();
  });

  it('does not apply a cached larger map before a body reaches the threshold', () => {
    queryClient.setQueryData(['optional-planet-texture', '/earth_high.ktx2'], new THREE.Texture());
    const { result } = renderHook(() => useTexturePromotion({ current: mesh }, '/earth_low.ktx2', 'high'), { wrapper });

    expect(result.current).toBeNull();
    expect(loadOptionalKTX2Texture).not.toHaveBeenCalled();
  });
});
