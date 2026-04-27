import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { renderHook } from '@testing-library/react';
import { useCameraAnimation } from './useCameraAnimation';
import { useSolarStore } from '@/store/solarStore';
import { useThree, useFrame } from '@react-three/fiber';

// Mock dependencies
vi.mock('@react-three/fiber', () => ({
  useThree: vi.fn(),
  useFrame: vi.fn(),
}));

vi.mock('@/store/solarStore', () => ({
  useSolarStore: {
    getState: vi.fn(),
  },
}));

vi.mock('@/store/missionStore', () => ({
  useMissionStore: {
    getState: vi.fn(),
  },
}));

vi.mock('@/lib/time/clockRuntime', () => ({
  clockRuntime: {
    getTimeMs: vi.fn(),
  },
}));

describe('useCameraAnimation (Origin-Only V2)', () => {
  type MockFn = ReturnType<typeof vi.fn>;
  type MockSolarState = {
    renderOrigin: { x: number; y: number; z: number };
    cameraNavMode: 'idle' | 'travel' | 'follow';
    followTargetId: string | null;
    setRenderOrigin: MockFn;
    startOriginTravel: MockFn;
    setFollowTarget: MockFn;
    stopOriginNavigation: MockFn;
    masterTrajectorySegments: Record<string, unknown>;
  };
  type MockThreeState = {
    camera: {
      position: THREE.Vector3;
      setLength: MockFn;
    };
    controls: {
      target: THREE.Vector3;
      update: MockFn;
    };
  };

  let mockThree: MockThreeState;
  let mockSolarState: MockSolarState;

  beforeEach(() => {
    vi.clearAllMocks();

    mockThree = {
      camera: {
        position: new THREE.Vector3(),
        setLength: vi.fn(),
      },
      controls: {
        target: new THREE.Vector3(1, 1, 1),
        update: vi.fn(),
      },
    };

    vi.mocked(useThree).mockReturnValue(mockThree);

    mockSolarState = {
      renderOrigin: { x: 0, y: 0, z: 0 },
      cameraNavMode: 'idle',
      followTargetId: null,
      setRenderOrigin: vi.fn(),
      startOriginTravel: vi.fn(),
      setFollowTarget: vi.fn(),
      stopOriginNavigation: vi.fn(),
      masterTrajectorySegments: {},
    };

    const mockedGetState = useSolarStore.getState as unknown as MockFn;
    mockedGetState.mockReturnValue(mockSolarState);
  });

  it('focusOn triggers startOriginTravel with calculated duration', () => {
    const { result } = renderHook(() => useCameraAnimation());
    
    const targetPos = { x: 1000, y: 0, z: 0 };
    result.current.focusOn(targetPos, 10, 'Earth');

    expect(mockSolarState.startOriginTravel).toHaveBeenCalledWith(
      targetPos,
      expect.any(Number),
      expect.any(Number),
      'Earth'
    );
  });

  it('stopTracking calls stopOriginNavigation', () => {
    const { result } = renderHook(() => useCameraAnimation());
    result.current.stopTracking();
    expect(mockSolarState.stopOriginNavigation).toHaveBeenCalled();
  });

  it('resetCamera starts travel to (0,0,0)', () => {
    const { result } = renderHook(() => useCameraAnimation());
    result.current.resetCamera();
    expect(mockSolarState.startOriginTravel).toHaveBeenCalledWith(
      { x: 0, y: 0, z: 0 },
      2000,
      expect.any(Number)
    );
  });

  it('enforces controls target at (0,0,0)', () => {
    renderHook(() => useCameraAnimation());
    
    // Get the frame callback
    type FrameCallback = (state: unknown, delta: number) => void;
    const frameCallback = vi.mocked(useFrame).mock.calls[0][0] as FrameCallback;
    frameCallback({}, 0.016);

    expect(mockThree.controls.target.x).toBe(0);
    expect(mockThree.controls.target.y).toBe(0);
    expect(mockThree.controls.target.z).toBe(0);
    expect(mockThree.controls.update).toHaveBeenCalled();
  });
});
