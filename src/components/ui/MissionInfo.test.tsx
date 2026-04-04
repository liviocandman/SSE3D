import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MissionInfo } from './MissionInfo';
import { 
  MissionMode, 
  MissionPhase, 
  MissionDataSource 
} from '@/lib/missionTypes';

describe('MissionInfo', () => {
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
    expect(screen.getByText('Artemis II Mission')).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('Translunar Coast')).toBeInTheDocument();
    
    // Check formatted MET
    expect(screen.getByText('T+ 02:04:30:15')).toBeInTheDocument();
    
    // Check formatted distance
    expect(screen.getByText('350,000')).toBeInTheDocument();
    
    // Check formatted velocity (1^2 + 0.5^2 + 0.2^2 = 1 + 0.25 + 0.04 = 1.29. Sqrt(1.29) approx 1.135. 1.135 * 3600 approx 4088)
    expect(screen.getByText('4,089')).toBeInTheDocument();
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
  });

  it('shows stale data warning', () => {
    const staleHealth = { ...mockMissionHealth, dataAgeSeconds: 120 };
    const staleState = { ...mockMissionState, stalenessSeconds: 120 };
    render(
      <MissionInfo 
        missionState={staleState} 
        missionHealth={staleHealth} 
        missionEvents={mockMissionEvents} 
      />
    );

    expect(screen.getByText(/Stale Data: 120s/)).toBeInTheDocument();
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

    expect(screen.getByText('Fallback Data Active')).toBeInTheDocument();
  });
});
