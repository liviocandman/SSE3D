import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SceneCanvas } from './SceneCanvas';
import { useMissionStore } from '@/store/missionStore';
import { useSolarStore } from '@/store/solarStore';
import { MissionPhase } from '@/lib/missionTypes';
import type { EphemerisData } from '@/lib/types';
import type { ForwardedRef } from 'react';

type QualityTierState = { tier: 'high' | 'mid' | 'low'; settings: { devicePixelRatio: number; antialias: boolean } };
type MockComponentProps = { children?: React.ReactNode };
type MockBillboardProps = { children?: React.ReactNode };
type MockSpacecraftProps = { vehicleId: string; onClick?: (id: string) => void; onDoubleClick?: (id: string) => void };
type MockSpacecraftBodyProps = MockSpacecraftProps & { missionTrajectorySegment: unknown; earthEphemeris: unknown };
type MockMilestoneProps = { label: string };
type MockLineProps = { dashed?: boolean };
type MockCelestialBodyProps = {
  children?: React.ReactNode;
  onClick?: (id: string) => void;
  onDoubleClick?: (id: string) => void;
  bodyId: string;
};
type StoreSelector<TState> = (state: TState) => unknown;
type MissionStoreMockState = {
  missionState: { vehicleId: string; sceneCoordinates: { x: number; y: number; z: number }; phase?: MissionPhase } | null;
  missionTrajectory?: { past: Array<{ timestamp: string; position: { x: number; y: number; z: number }; segment: string }>; planned: Array<unknown> };
  missionEvents?: { events: Array<{ id: string; name: string; timestamp: string; phase: MissionPhase }> };
  selectedMissionTargetId: string | null;
  setSelectedMissionTargetId: (missionTargetId: string | null) => void;
  autoFocusEvents: boolean;
  estimatedAttitudeEnabled: boolean;
};
type SolarStoreMockState = {
  currentTime: Date;
  selectedPlanet: {
    bodyId: string;
    name: string;
    englishName: string;
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    radius: number;
    distanceFromSun: number;
    trajectory: Array<unknown>;
  } | null;
  setSelectedPlanet: (...args: unknown[]) => void;
  viewMode: 'didactic';
  setViewMode: ReturnType<typeof vi.fn>;
  travelTarget: null;
  travelTargetRadius: number;
  setTravelTarget: (target: { x: number; y: number; z: number }, radius: number) => void;
  resetTravel: ReturnType<typeof vi.fn>;
  masterTrajectory: Record<string, unknown>;
  masterTrajectorySegments: Record<string, unknown>;
  fullOrbits: Record<string, unknown>;
  appendFullOrbits: ReturnType<typeof vi.fn>;
  advanceTime: ReturnType<typeof vi.fn>;
  renderOrigin: { x: number; y: number; z: number };
};

function applySolarStoreMock(state: SolarStoreMockState) {
  vi.mocked(useSolarStore).mockImplementation(
    ((selector?: unknown) => {
      if (typeof selector === 'function') {
        return (selector as StoreSelector<SolarStoreMockState>)(state);
      }
      return state;
    }) as typeof useSolarStore,
  );
}

function applyMissionStoreMock(state: MissionStoreMockState) {
  vi.mocked(useMissionStore).mockImplementation(
    ((selector?: unknown) => {
      if (typeof selector === 'function') {
        return (selector as StoreSelector<MissionStoreMockState>)(state);
      }
      return state;
    }) as typeof useMissionStore,
  );
}

function createEarthEphemeris(): EphemerisData[] {
  return [{
    bodyId: '399',
    name: 'Earth',
    timestamp: '2026-04-01T12:00:00Z',
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    trajectory: [],
  }];
}

// Mock store
vi.mock('@/store/missionStore', () => ({
  useMissionStore: vi.fn(),
}));

vi.mock('@/store/solarStore', () => ({
  useSolarStore: vi.fn(),
}));

vi.mock('@/contexts/QualityTierContext', () => ({
  useQualityTier: (): QualityTierState => ({ tier: 'high', settings: { devicePixelRatio: 1, antialias: true } }),
  QualityTierProvider: ({ children }: MockComponentProps) => <div>{children}</div>,
}));

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: MockComponentProps) => <div data-testid="canvas">{children}</div>,
  useFrame: vi.fn(),
  useThree: vi.fn(() => ({ gl: {} })),
  useLoader: vi.fn(() => ({})),
}));

vi.mock('@react-three/drei', async () => {
  const ReactModule = await import('react');
  const { createElement, forwardRef } = ReactModule;

  return {
    OrbitControls: () => <div />,
    Stars: () => <div />,
    Billboard: ({ children }: MockBillboardProps) => <div data-testid="billboard">{children}</div>,
    Text: ({ children }: MockBillboardProps) => <div data-testid="text">{children}</div>,
    Line: forwardRef(function MockLine({ dashed }: MockLineProps, ref: ForwardedRef<HTMLDivElement>) {
      return createElement('div', {
        ref,
        'data-testid': 'line',
        'data-dashed': dashed ? 'true' : 'false',
      });
    }),
    Html: ({ children }: MockBillboardProps) => <div data-testid="html">{children}</div>,
  };
});

vi.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: MockComponentProps) => <div>{children}</div>,
  Bloom: () => <div />,
}));

vi.mock('./SpacecraftBody', () => ({
  SpacecraftBody: ({ vehicleId, onClick, onDoubleClick }: MockSpacecraftBodyProps) => (
    <div data-testid="spacecraft" onClick={() => onClick?.(vehicleId)} onDoubleClick={() => onDoubleClick?.(vehicleId)}>
      {vehicleId}
    </div>
  ),
  SPACECRAFT_CLOSEUP_RADIUS_UNITS: 0.00008,
  SPACECRAFT_EVENT_FOCUS_RADIUS_UNITS: 0.0015,
  SPACECRAFT_SELECTION_RADIUS_UNITS: 0.0005,
}));

vi.mock('./MissionTrajectoryLine', () => ({
  MissionTrajectoryLine: () => <div data-testid="trajectory-line" />,
}));

vi.mock('./MissionMilestoneMarker', () => ({
  MissionMilestoneMarker: ({ label }: MockMilestoneProps) => <div data-testid="milestone-marker">{label}</div>,
}));

vi.mock('./MoonSystem', () => ({
  MoonSystem: () => <div data-testid="moon-system" />,
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

vi.mock('./CelestialBody', () => ({
  CelestialBody: ({ children, onClick, onDoubleClick, bodyId }: MockCelestialBodyProps) => (
    <div data-testid="celestial-body" data-body-id={bodyId} onClick={() => onClick?.(bodyId)} onDoubleClick={() => onDoubleClick?.(bodyId)}>
      {children}
    </div>
  ),
}));

describe('SceneManager / SceneCanvas', () => {
  const setTravelTarget = vi.fn();
  const setSelectedMissionTargetId = vi.fn();
  const setSelectedPlanet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock global fetch to avoid URL errors
    global.fetch = vi.fn().mockImplementation(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      })
    );

    // Basic mock of solarStore
    applySolarStoreMock({
        currentTime: new Date('2026-04-01T12:00:00Z'),
        selectedPlanet: {
          bodyId: '399',
          name: 'Terra',
          englishName: 'Earth',
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          radius: 1,
          distanceFromSun: 0,
          trajectory: [],
        },
        setSelectedPlanet,
        viewMode: 'didactic',
        setViewMode: vi.fn(),
        travelTarget: null,
        travelTargetRadius: 1,
        setTravelTarget,
        resetTravel: vi.fn(),
        masterTrajectory: {},
        masterTrajectorySegments: {},
        fullOrbits: {},
        appendFullOrbits: vi.fn(),
        advanceTime: vi.fn(),
        renderOrigin: { x: 0, y: 0, z: 0 },
      });
  });

  it('renders spacecraft when missionState has sceneCoordinates', () => {
    applyMissionStoreMock({
        missionState: {
          vehicleId: 'orion',
          sceneCoordinates: { x: 1000, y: 0, z: 0 },
        },
        selectedMissionTargetId: null,
        setSelectedMissionTargetId,
        autoFocusEvents: false,
        estimatedAttitudeEnabled: true,
      });

    const mockEarthEphemeris = createEarthEphemeris();

    const { getByTestId } = render(<SceneCanvas ephemerisData={mockEarthEphemeris} />);
    expect(getByTestId('spacecraft')).toBeInTheDocument();
  });

  it('does not render spacecraft when Earth is not the active parent context', () => {
    applyMissionStoreMock({
        missionState: {
          vehicleId: 'orion',
          sceneCoordinates: { x: 1000, y: 0, z: 0 },
        },
        selectedMissionTargetId: null,
        setSelectedMissionTargetId,
        autoFocusEvents: false,
        estimatedAttitudeEnabled: true,
      });

    applySolarStoreMock({
        currentTime: new Date('2026-04-01T12:00:00Z'),
        selectedPlanet: null,
        setSelectedPlanet,
        viewMode: 'didactic',
        setViewMode: vi.fn(),
        travelTarget: null,
        travelTargetRadius: 1,
        setTravelTarget,
        resetTravel: vi.fn(),
        masterTrajectory: {},
        masterTrajectorySegments: {},
        fullOrbits: {},
        appendFullOrbits: vi.fn(),
        advanceTime: vi.fn(),
        renderOrigin: { x: 0, y: 0, z: 0 },
      });

    const mockEarthEphemeris = createEarthEphemeris();

    const { queryByTestId } = render(<SceneCanvas ephemerisData={mockEarthEphemeris} />);
    expect(queryByTestId('spacecraft')).not.toBeInTheDocument();
  });

  it('renders milestones when missionEvents has major phases', () => {
    applyMissionStoreMock({
        missionState: { vehicleId: 'orion', sceneCoordinates: { x: 0, y: 0, z: 0 } },
        missionTrajectory: { 
          past: [
            { timestamp: '2026-04-01T12:00:00Z', position: { x: 0, y: 0, z: 0 }, segment: 'past' }
          ], 
          planned: [] 
        },
        missionEvents: {
          events: [
            {
              id: '1',
              name: 'TLI',
              timestamp: '2026-04-01T12:00:00Z',
              phase: MissionPhase.EARTH_DEPARTURE,
            },
          ],
        },
        selectedMissionTargetId: null,
        setSelectedMissionTargetId,
        autoFocusEvents: false,
        estimatedAttitudeEnabled: true,
      });

    const mockEarthEphemeris = createEarthEphemeris();

    const { getByTestId } = render(<SceneCanvas ephemerisData={mockEarthEphemeris} />);
    expect(getByTestId('milestone-marker')).toBeInTheDocument();
    expect(getByTestId('milestone-marker')).toHaveTextContent('TLI');
  });
});
