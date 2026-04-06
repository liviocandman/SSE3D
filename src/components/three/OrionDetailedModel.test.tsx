import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrionDetailedModel, getOrionDetailedAssetPath } from './OrionDetailedModel';
import * as THREE from 'three';

const mockSetKTX2Loader = vi.fn();
const mockUseGLTF = vi.fn();
const mockUseQualityTier = vi.fn(() => ({ tier: 'mid', settings: {} }));

vi.mock('@react-three/fiber', () => ({
  useThree: vi.fn((selector: (state: { gl: object }) => unknown) => selector({ gl: {} })),
}));

vi.mock('@/contexts/QualityTierContext', () => ({
  useQualityTier: () => mockUseQualityTier(),
}));

vi.mock('@/lib/SingletonKTX2Loader', () => ({
  getSharedKTX2Loader: vi.fn(() => ({ mocked: true })),
}));

vi.mock('@react-three/drei', () => ({
  useGLTF: (...args: unknown[]) => mockUseGLTF(...args),
}));

mockUseGLTF.mockImplementation((_url: string, _useDraco: boolean, _useMeshOpt: unknown, extendLoader?: (loader: { setKTX2Loader: typeof mockSetKTX2Loader }) => void) => {
    extendLoader?.({ setKTX2Loader: mockSetKTX2Loader });
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 1),
      new THREE.MeshStandardMaterial({ name: 'mirror chrome', metalness: 1, roughness: 0.05 })
    );
    scene.add(mesh);
    return { scene };
  });

describe('OrionDetailedModel', () => {
  beforeEach(() => {
    mockSetKTX2Loader.mockClear();
    mockUseGLTF.mockClear();
    mockUseQualityTier.mockReset();
    mockUseQualityTier.mockReturnValue({ tier: 'mid', settings: {} });
  });

  it('calls onReady after loading the scene', () => {
    const onReady = vi.fn();

    render(<OrionDetailedModel onReady={onReady} />);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(mockSetKTX2Loader).toHaveBeenCalledTimes(1);
    expect(mockUseGLTF).toHaveBeenCalledWith(
      '/models/orion/artemis_ii-medium.glb',
      true,
      undefined,
      expect.any(Function)
    );
  });

  it('resolves the correct asset path for each quality tier', () => {
    expect(getOrionDetailedAssetPath('high')).toBe('/models/orion/artemis_ii-high.glb');
    expect(getOrionDetailedAssetPath('mid')).toBe('/models/orion/artemis_ii-medium.glb');
    expect(getOrionDetailedAssetPath('low')).toBe('/models/orion/artemis_ii-low.glb');
  });

  it('loads the low tier asset when quality tier is low', () => {
    mockUseQualityTier.mockReturnValue({ tier: 'low', settings: {} });

    render(<OrionDetailedModel />);

    expect(mockUseGLTF).toHaveBeenCalledWith(
      '/models/orion/artemis_ii-low.glb',
      true,
      undefined,
      expect.any(Function)
    );
  });

  it('loads the high tier asset when quality tier is high', () => {
    mockUseQualityTier.mockReturnValue({ tier: 'high', settings: {} });

    render(<OrionDetailedModel />);

    expect(mockUseGLTF).toHaveBeenCalledWith(
      '/models/orion/artemis_ii-high.glb',
      true,
      undefined,
      expect.any(Function)
    );
  });
});
