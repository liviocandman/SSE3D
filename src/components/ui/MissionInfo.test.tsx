import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MissionInfo } from './MissionInfo';
import { 
  MissionMode, 
  MissionPhase, 
  MissionDataSource 
} from '@/lib/missionTypes';

// Mock zustand shallow
vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: T) => selector,
}));

// Setup hoisted mock state
const { missionStoreState } = vi.hoisted(() => ({
  missionStoreState: {
    autoFocusEvents: false,
    setAutoFocusEvents: vi.fn(),
    estimatedAttitudeEnabled: true,
    setEstimatedAttitudeEnabled: vi.fn(),
  }
}));

vi.mock('@/store/missionStore', () => ({
  useMissionStore: vi.fn((selector) => selector ? selector(missionStoreState) : missionStoreState),
}));

describe('MissionInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockMissionState = {
    missionId: 'artemis-2',
    vehicleId: 'orion',
    mode: MissionMode.LIVE,
    phase: MissionPhase.TRANSLUNAR_COAST,
    source: MissionDataSource.AROW_LIVE,
    sourceTimestamp: '2026-04-04T12:00:00Z',
    stalenessSeconds: 10,
    position: { x: 100000, y: 50000, z: 20000 },
    velocity: { x: 1, y: 0.5, z: 0.2 },
    distances: { earthKm: 350000, moonKm: 50000 },
    missionElapsedTime: '2-04:30:15',
    solarRangeKm: 149600000,
    lineOfSightStatus: 'lunar_occultation' as const,
    attitudeSource: 'GEOMETRIC_FALLBACK' as const,
    attitudeMode: 'HOLD' as const,
    attitudeConfidence: 0.65,
    referenceFrame: 'ECLIPJ2000' as const,
  };

  const mockMissionHealth = {
    missionId: 'artemis-2',
    currentSource: MissionDataSource.AROW_LIVE,
    lastUpdate: '2026-04-04T12:00:00Z',
    dataAgeSeconds: 10,
    fallbackActive: false,
    coverageStart: '2026-04-01T00:00:00Z',
    coverageEnd: '2026-04-10T00:00:00Z',
  };

  const mockMissionEvents = {
    missionId: 'artemis-2',
    events: [],
    currentPhase: MissionPhase.TRANSLUNAR_COAST,
    nextEvent: {
      id: 'event-1',
      name: 'Lunar Orbit Insertion',
      description: 'Main engine burn to enter lunar orbit.',
      timestamp: '2026-04-05T10:00:00Z',
      phase: MissionPhase.LUNAR_FLYBY,
      isCompleted: false,
    },
  };

  it('renders correctly with mission data', () => {
    render(
      <MissionInfo 
        missionState={mockMissionState} 
        missionHealth={mockMissionHealth} 
        missionEvents={mockMissionEvents} 
      />
    );

    expect(screen.getByText('Orion')).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('Translunar Coast')).toBeInTheDocument();
    
    // Check formatted MET
    expect(screen.getByText('T+ 02:04:30:15')).toBeInTheDocument();
    
    // Check formatted distance
    expect(screen.getByText('350,000')).toBeInTheDocument();
    
    // Check formatted velocity
    expect(screen.getByText('4,089')).toBeInTheDocument();
    expect(screen.getByText('1.17 s')).toBeInTheDocument();
    expect(screen.getByText('+1.14')).toBeInTheDocument();
    expect(screen.getByText('149.6M km')).toBeInTheDocument();
    expect(screen.getByText('LOS - Lunar Occultation')).toBeInTheDocument();
    expect(screen.getByText(/GEOMETRIC FALLBACK \| HOLD \| ECLIPJ2000 \| 65%/)).toBeInTheDocument();
  });

  it('shows next event when available', () => {
    render(
      <MissionInfo 
        missionState={mockMissionState} 
        missionHealth={mockMissionHealth} 
        missionEvents={mockMissionEvents} 
      />
    );

    expect(screen.getByText('Upcoming Event')).toBeInTheDocument();
    expect(screen.getByText('Lunar Orbit Insertion')).toBeInTheDocument();
    expect(screen.getByText('in 22h 00m')).toBeInTheDocument();
  });

  it('shows stale data warning when missionHealth is missing but stalenessSeconds is high', () => {
    const staleState = { ...mockMissionState, stalenessSeconds: 120 };
    render(
      <MissionInfo 
        missionState={staleState} 
        missionHealth={null} 
        missionEvents={mockMissionEvents} 
      />
    );

    expect(screen.getByText(/Telemetry Lag:/)).toBeInTheDocument();
    expect(screen.getByText(/120s/)).toBeInTheDocument();
  });

  it('shows stale data warning when missionHealth reporting high dataAgeSeconds', () => {
    const staleHealth = { ...mockMissionHealth, dataAgeSeconds: 150 };
    render(
      <MissionInfo 
        missionState={mockMissionState} 
        missionHealth={staleHealth} 
        missionEvents={mockMissionEvents} 
      />
    );

    expect(screen.getByText(/Telemetry Lag:/)).toBeInTheDocument();
    expect(screen.getByText(/150s/)).toBeInTheDocument();
  });

  it('shows fallback data active warning', () => {
    const fallbackHealth = { ...mockMissionHealth, fallbackActive: true };
    render(
      <MissionInfo 
        missionState={mockMissionState} 
        missionHealth={fallbackHealth} 
        missionEvents={mockMissionEvents} 
      />
    );

    expect(screen.getByText(/Fallback Mode Active/)).toBeInTheDocument();
  });

  it('switches to altitude near Earth', () => {
    const nearEarthState = {
      ...mockMissionState,
      distances: { earthKm: 6_771, moonKm: 380_000 },
      lineOfSightStatus: 'clear' as const,
      solarRangeKm: undefined,
    };

    render(
      <MissionInfo
        missionState={nearEarthState}
        missionHealth={mockMissionHealth}
        missionEvents={mockMissionEvents}
      />,
    );

    expect(screen.getByText('Altitude')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
  });

  it('shows source explanations', () => {
    const archiveState = { ...mockMissionState, source: MissionDataSource.ARCHIVE };
    const { rerender } = render(
      <MissionInfo 
        missionState={archiveState} 
        missionHealth={mockMissionHealth} 
        missionEvents={mockMissionEvents} 
      />
    );

    expect(screen.getByText(/Archived Data:/)).toBeInTheDocument();
    expect(screen.getByText(/High-fidelity historical records/)).toBeInTheDocument();

    const predictedState = { ...mockMissionState, source: MissionDataSource.SPICE_PREDICTED };
    rerender(
      <MissionInfo 
        missionState={predictedState} 
        missionHealth={mockMissionHealth} 
        missionEvents={mockMissionEvents} 
      />
    );

    expect(screen.getByText(/Predicted State:/)).toBeInTheDocument();
    expect(screen.getByText(/Simulated trajectory based on orbital mechanics/)).toBeInTheDocument();
  });

  it('toggles auto focus events', () => {
    render(
      <MissionInfo 
        missionState={mockMissionState} 
        missionHealth={mockMissionHealth} 
        missionEvents={mockMissionEvents} 
      />
    );

    // Look for the Auto Focus button/text
    const toggle = screen.getByText('Auto Focus');
    fireEvent.click(toggle);
    expect(missionStoreState.setAutoFocusEvents).toHaveBeenCalledWith(true);
  });

  it('toggles estimated attitude rendering', () => {
    render(
      <MissionInfo
        missionState={mockMissionState}
        missionHealth={mockMissionHealth}
        missionEvents={mockMissionEvents}
      />
    );

    const toggleLabel = screen.getAllByText('Attitude')[0];
    const toggle = toggleLabel.closest('button');
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle!);
    expect(missionStoreState.setEstimatedAttitudeEnabled).toHaveBeenCalledWith(false);
  });

  it('renders the NOSE TO MOON attitude label from backend metadata', () => {
    render(
      <MissionInfo
        missionState={{ ...mockMissionState, attitudeMode: 'NOSE_TO_MOON' as const }}
        missionHealth={mockMissionHealth}
        missionEvents={mockMissionEvents}
      />
    );

    expect(screen.getByText(/GEOMETRIC FALLBACK \| NOSE TO MOON \| ECLIPJ2000 \| 65%/)).toBeInTheDocument();
  });
});
