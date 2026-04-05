import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrionDetailedModel } from './OrionDetailedModel';
import * as THREE from 'three';

const mockSetKTX2Loader = vi.fn();

vi.mock('@react-three/fiber', () => ({
  useThree: vi.fn((selector: (state: { gl: object }) => unknown) => selector({ gl: {} })),
}));

vi.mock('@/lib/SingletonKTX2Loader', () => ({
  getSharedKTX2Loader: vi.fn(() => ({ mocked: true })),
}));

vi.mock('@react-three/drei', () => ({
  useGLTF: vi.fn((_url: string, _useDraco: boolean, _useMeshOpt: unknown, extendLoader?: (loader: { setKTX2Loader: typeof mockSetKTX2Loader }) => void) => {
    extendLoader?.({ setKTX2Loader: mockSetKTX2Loader });
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 1),
      new THREE.MeshStandardMaterial({ name: 'mirror chrome', metalness: 1, roughness: 0.05 })
    );
    scene.add(mesh);
    return { scene };
  }),
}));

describe('OrionDetailedModel', () => {
  it('calls onReady after loading the scene', () => {
    const onReady = vi.fn();

    render(<OrionDetailedModel onReady={onReady} />);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(mockSetKTX2Loader).toHaveBeenCalledTimes(1);
  });
});
