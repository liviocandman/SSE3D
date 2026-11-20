import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Children, isValidElement, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader, useThree, type RootState } from '@react-three/fiber';
import { CelestialBody } from './CelestialBody';
import { useSolarStore } from '@/store/solarStore';
import { buildTrajectorySegments } from '@/lib/trajectoryEngine';
import { clockRuntime } from '@/lib/time/clockRuntime';

vi.mock('@react-three/fiber', () => ({ useFrame: vi.fn(), useThree: vi.fn(), useLoader: vi.fn() }));
vi.mock('@react-three/drei', () => ({ Text: 'text', Billboard: 'billboard' }));
// The global test mock replaces useShallow with identity, which cannot cache
// object snapshots for a real Zustand store. Exercise the real selector here.
vi.mock('zustand/react/shallow', async importOriginal => importOriginal());

const START = Date.parse('2026-01-01T00:00:00Z');
const trajectory = [0, 10].map(second => ({ timestamp: new Date(START + second * 1000).toISOString(),
  position: { x: 149600000 + second * 100, y: 0, z: 0 } }));

describe('CelestialBody rotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const camera = new THREE.PerspectiveCamera(45, 1.6, 0.00001, 50000);
    camera.position.z = 500; camera.updateMatrixWorld();
    const threeState = { camera, gl: {}, size: { width: 1440, height: 900 } } as RootState;
    vi.mocked(useThree).mockImplementation(((selector?: (state: RootState) => unknown) =>
      selector ? selector(threeState) : threeState) as typeof useThree);
    vi.mocked(useLoader).mockReturnValue(new THREE.Texture() as never);
    useSolarStore.setState({ renderOrigin: { x: 0, y: 0, z: 0 }, selectedPlanet: null,
      masterTrajectorySegments: { '399': buildTrajectorySegments(trajectory, '399') } });
    clockRuntime.setTimeMs(START);
  });

  it.each([
    { body: 'Venus', bodyId: '299', dayLength: -5832.5, axialTilt: 177.4, expectedWorldSign: -1 },
    { body: 'Uranus', bodyId: '799', dayLength: 17.2, axialTilt: 97.77, expectedWorldSign: 1 },
    { body: 'Earth', bodyId: '399', dayLength: 24, axialTilt: 23.4, expectedWorldSign: 1 },
  ])('keeps $body spin direction consistent in world coordinates in both view modes', ({ bodyId, dayLength, axialTilt, expectedWorldSign }) => {
    for (const viewMode of ['didactic', 'realistic'] as const) {
      const { result, unmount } = renderHook(() => CelestialBody({ bodyId, name: bodyId, englishName: bodyId,
        position: [0, 0, 0], radius: 1, textureUrl: '/body_low.ktx2', dayLength, axialTilt,
        rotationSpeed: 0.001, viewMode }));
      const children = Children.toArray(result.current.props.children);
      const candidate = children.find(child => isValidElement<{ rotation?: [number, number, number]; children?: React.ReactNode }>(child)
        && child.props.rotation?.[0] !== undefined);
      if (!isValidElement<{ rotation?: [number, number, number]; children?: React.ReactNode }>(candidate)) throw new Error('Tilted group missing');
      const tiltedGroup = candidate;
      const surface = Children.toArray(tiltedGroup.props.children).find(child =>
        isValidElement<{ userData?: { selectionKind?: string } }>(child)
          && child.props.userData?.selectionKind === 'surface');
      if (!isValidElement<{ ref: RefObject<THREE.Mesh> }>(surface)) throw new Error('Planet surface missing');
      const mesh = new THREE.Mesh();
      surface.props.ref.current = mesh;
      const frame = vi.mocked(useFrame).mock.calls.at(-1)![0];
      frame({ clock: { elapsedTime: 0 } } as RootState, 1 / 60);
      const before = mesh.rotation.y;
      if (viewMode === 'realistic') clockRuntime.setTimeMs(START + 1000);
      frame({ clock: { elapsedTime: 1 } } as RootState, 1 / 60);
      const rawDelta = mesh.rotation.y - before;
      const localAngularDelta = viewMode === 'realistic'
        ? Math.atan2(Math.sin(rawDelta), Math.cos(rawDelta))
        : rawDelta;
      const worldAngularDelta = localAngularDelta * Math.cos(THREE.MathUtils.degToRad(axialTilt));
      expect(Math.sign(worldAngularDelta), `${bodyId} in ${viewMode}`).toBe(expectedWorldSign);
      unmount();
    }
  });
});
