import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SceneContent } from './SceneManager';
import { useMissionStore } from '@/store/missionStore';
import { useSolarStore } from '@/store/solarStore';

// Mock store
vi.mock('@/store/missionStore', () => ({
  useMissionStore: vi.fn(),
}));

vi.mock('@/store/solarStore', () => ({
  useSolarStore: vi.fn(),
}));

vi.mock('@/contexts/QualityTierContext', () => ({
  useQualityTier: () => ({ tier: 'high', settings: { devicePixelRatio: 1, antialias: true } }),
  QualityTierProvider: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: any) => <div data-testid="canvas">{children}</div>,
  useFrame: vi.fn(),
  useThree: vi.fn(() => ({ gl: {} })),
  useLoader: vi.fn(() => ({})),
}));

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => <div />,
  Stars: () => <div />,
  Billboard: ({ children }: any) => <div data-testid="billboard">{children}</div>,
  Text: ({ children }: any) => <div data-testid="text">{children}</div>,
}));

vi.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: any) => <div>{children}</div>,
  Bloom: () => <div />,
}));

vi.mock('./SpacecraftBody', () => ({
  SpacecraftBody: ({ vehicleId }: any) => <div data-testid="spacecraft">{vehicleId}</div>,
}));

vi.mock('@/hooks/useCameraAnimation', () => ({
  CameraController: () => <div />,
}));

vi.mock('./Sun', () => ({
  Sun: () => <div />,
}));

vi.mock('./TrajectoryManager', () => ({
  TrajectoryManager: () => <div />,
}));

describe('SceneManager / SceneContent', () => {
  beforeEach(() => {
    // Basic mock of solarStore
    vi.mocked(useSolarStore).mockImplementation(() => ({
      selectedPlanet: null,
      setSelectedPlanet: vi.fn(),
      viewMode: 'didactic',
      setViewMode: vi.fn(),
      travelTarget: null,
      travelTargetRadius: 1,
      setTravelTarget: vi.fn(),
      masterTrajectorySegments: {},
      fullOrbits: {},
      appendFullOrbits: vi.fn(),
      advanceTime: vi.fn(),
    }));
  });

  it('renders spacecraft when missionState has sceneCoordinates', () => {
    // Mock missionStore returning scene coordinates
    vi.mocked(useMissionStore).mockImplementation(() => ({
      missionState: {
        vehicleId: 'orion',
        sceneCoordinates: { x: 1000, y: 0, z: 0 },
      },
      selectedMissionTargetId: null,
      setSelectedMissionTargetId: vi.fn(),
    }));

    const mockEarthEphemeris = [{
      bodyId: '399',
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      trajectory: [],
    }];

    const { getByTestId } = render(<SceneContent ephemerisData={mockEarthEphemeris as any} />);
    expect(getByTestId('spacecraft')).toBeInTheDocument();
    expect(getByTestId('spacecraft')).toHaveTextContent('orion');
  });

  it('does not render spacecraft when missionState is missing', () => {
    vi.mocked(useMissionStore).mockImplementation(() => ({
      missionState: null,
      selectedMissionTargetId: null,
      setSelectedMissionTargetId: vi.fn(),
    }));

    const { queryByTestId } = render(<SceneContent ephemerisData={[]} />);
    expect(queryByTestId('spacecraft')).toBeNull();
  });
});
