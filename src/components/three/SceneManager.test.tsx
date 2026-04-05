import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SceneContent } from './SceneManager';
import { useMissionStore } from '@/store/missionStore';
import { useSolarStore } from '@/store/solarStore';
import { MissionPhase } from '@/lib/missionTypes';
import { SPACECRAFT_CLOSEUP_RADIUS_UNITS, SPACECRAFT_EVENT_FOCUS_RADIUS_UNITS } from './SpacecraftBody';

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
  SpacecraftBody: ({ vehicleId, onClick, onDoubleClick }: any) => (
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
  MissionMilestoneMarker: ({ label }: any) => <div data-testid="milestone-marker">{label}</div>,
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

describe('SceneManager / SceneContent', () => {
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
    vi.mocked(useSolarStore).mockImplementation((selector: any) => 
      selector({
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
      })
    );
  });

  it('renders spacecraft when missionState has sceneCoordinates', () => {
    vi.mocked(useMissionStore).mockImplementation((selector: any) => 
      selector({
        missionState: {
          vehicleId: 'orion',
          sceneCoordinates: { x: 1000, y: 0, z: 0 },
        },
        selectedMissionTargetId: null,
        setSelectedMissionTargetId,
        autoFocusEvents: false,
        estimatedAttitudeEnabled: true,
      })
    );

    const mockEarthEphemeris = [{
      bodyId: '399',
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      trajectory: [],
    }];

    const { getByTestId } = render(<SceneContent ephemerisData={mockEarthEphemeris as any} />);
    expect(getByTestId('spacecraft')).toBeInTheDocument();
  });

  it('does not render spacecraft when Earth is not the active parent context', () => {
    vi.mocked(useMissionStore).mockImplementation((selector: any) =>
      selector({
        missionState: {
          vehicleId: 'orion',
          sceneCoordinates: { x: 1000, y: 0, z: 0 },
        },
        selectedMissionTargetId: null,
        setSelectedMissionTargetId,
        autoFocusEvents: false,
        estimatedAttitudeEnabled: true,
      })
    );

    vi.mocked(useSolarStore).mockImplementation((selector: any) =>
      selector({
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
      })
    );

    const mockEarthEphemeris = [{
      bodyId: '399',
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      trajectory: [],
    }];

    const { queryByTestId } = render(<SceneContent ephemerisData={mockEarthEphemeris as any} />);
    expect(queryByTestId('spacecraft')).not.toBeInTheDocument();
  });

  it('uses dedicated close-up radius when spacecraft is double-clicked', () => {
    vi.mocked(useMissionStore).mockImplementation((selector: any) =>
      selector({
        missionState: {
          vehicleId: 'orion',
          sceneCoordinates: { x: 1000, y: 0, z: 0 },
        },
        selectedMissionTargetId: null,
        setSelectedMissionTargetId,
        autoFocusEvents: false,
        estimatedAttitudeEnabled: true,
      })
    );

    const mockEarthEphemeris = [{
      bodyId: '399',
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      trajectory: [],
    }];

    const { getByTestId } = render(<SceneContent ephemerisData={mockEarthEphemeris as any} />);
    fireEvent.doubleClick(getByTestId('spacecraft'));

    expect(setSelectedPlanet).toHaveBeenCalled();
    expect(setTravelTarget).toHaveBeenCalledWith(
      { x: 0.001, y: 0, z: 0 },
      SPACECRAFT_CLOSEUP_RADIUS_UNITS
    );
  });

  it('triggers non-intrusive auto-focus on major mission events', async () => {
    vi.mocked(useMissionStore).mockImplementation((selector: any) => 
      selector({
        missionState: {
          vehicleId: 'orion',
          sceneCoordinates: { x: 1000, y: 0, z: 0 },
          phase: MissionPhase.EARTH_DEPARTURE,
        },
        missionTrajectory: { past: [], planned: [] },
        missionEvents: {
          events: [
            { id: 'ev-1', name: 'TLI', timestamp: '2026-04-01T12:00:10Z', phase: MissionPhase.EARTH_DEPARTURE },
          ],
        },
        selectedMissionTargetId: null,
        setSelectedMissionTargetId,
        autoFocusEvents: true,
        estimatedAttitudeEnabled: true,
      })
    );

    const mockEarthEphemeris = [{
      bodyId: '399',
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      trajectory: [],
    }];

    render(<SceneContent ephemerisData={mockEarthEphemeris as any} />);

    // Camera should move with mission-centric framing
    expect(setTravelTarget).toHaveBeenCalledWith(
      { x: 0.001, y: 0, z: 0 },
      SPACECRAFT_EVENT_FOCUS_RADIUS_UNITS
    );
    
    // Selection should NOT be hijacked (P2 fix)
    expect(setSelectedMissionTargetId).not.toHaveBeenCalled();
    expect(setSelectedPlanet).not.toHaveBeenCalled();
  });

  it('re-arms auto-focus after leaving and re-entering an event window', () => {
    const missionSelectorImpl = (currentTimeIso: string) => (selector: any) =>
      selector({
        missionState: {
          vehicleId: 'orion',
          sceneCoordinates: { x: 1000, y: 0, z: 0 },
          phase: MissionPhase.LUNAR_FLYBY,
        },
        missionTrajectory: { past: [], planned: [] },
        missionEvents: {
          events: [
            {
              id: 'ev-flyby',
              name: 'Lunar Flyby',
              timestamp: '2026-04-01T12:00:10Z',
              phase: MissionPhase.LUNAR_FLYBY,
            },
          ],
        },
        selectedMissionTargetId: null,
        setSelectedMissionTargetId,
        autoFocusEvents: true,
        estimatedAttitudeEnabled: true,
      });

    const solarSelectorImpl = (currentTimeIso: string) => (selector: any) =>
      selector({
        currentTime: new Date(currentTimeIso),
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
      });

    vi.mocked(useMissionStore).mockImplementation(missionSelectorImpl('2026-04-01T12:00:00Z'));
    vi.mocked(useSolarStore).mockImplementation(solarSelectorImpl('2026-04-01T12:00:00Z'));

    const mockEarthEphemeris = [{
      bodyId: '399',
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      trajectory: [],
    }];

    const { rerender } = render(<SceneContent ephemerisData={mockEarthEphemeris as any} />);
    expect(setTravelTarget).toHaveBeenCalledTimes(1);

    vi.mocked(useMissionStore).mockImplementation(missionSelectorImpl('2026-04-01T12:03:00Z'));
    vi.mocked(useSolarStore).mockImplementation(solarSelectorImpl('2026-04-01T12:03:00Z'));
    rerender(<SceneContent ephemerisData={mockEarthEphemeris as any} />);
    expect(setTravelTarget).toHaveBeenCalledTimes(1);

    vi.mocked(useMissionStore).mockImplementation(missionSelectorImpl('2026-04-01T12:00:20Z'));
    vi.mocked(useSolarStore).mockImplementation(solarSelectorImpl('2026-04-01T12:00:20Z'));
    rerender(<SceneContent ephemerisData={mockEarthEphemeris as any} />);
    expect(setTravelTarget).toHaveBeenCalledTimes(2);
    expect(setSelectedMissionTargetId).not.toHaveBeenCalled();
    expect(setSelectedPlanet).not.toHaveBeenCalled();
  });

  it('renders milestones when missionEvents has major phases', () => {
    vi.mocked(useMissionStore).mockImplementation((selector: any) => 
      selector({
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
      })
    );

    const mockEarthEphemeris = [{
      bodyId: '399',
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      trajectory: [],
    }];

    const { getByTestId } = render(<SceneContent ephemerisData={mockEarthEphemeris as any} />);
    expect(getByTestId('milestone-marker')).toBeInTheDocument();
    expect(getByTestId('milestone-marker')).toHaveTextContent('TLI');
  });
});
