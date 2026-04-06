import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimeTravelControls } from './TimeTravelControls';

// Mock zustand shallow
vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: T) => selector,
}));

// Setup hoisted mocks
const { solarState, missionState } = vi.hoisted(() => {
  return {
    solarState: {
      currentDate: '2026-03-26',
      isPlaying: false,
      setIsPlaying: vi.fn(),
      setCurrentDate: vi.fn(),
      setCurrentTime: vi.fn(),
    },
    missionState: {
      isLive: false,
      liveTimestamp: '2026-04-04T12:00:00Z',
      setIsLive: vi.fn(),
    }
  };
});

vi.mock('@/store/solarStore', () => {
  const mock = vi.fn((selector) => selector ? selector(solarState) : solarState);
  // @ts-expect-error - Mocking the store object
  mock.getState = vi.fn(() => ({ currentTime: new Date('2026-03-26T00:00:00.000Z') }));
  return { useSolarStore: mock };
});

vi.mock('@/store/missionStore', () => {
  const mock = vi.fn((selector) => selector ? selector(missionState) : missionState);
  return { useMissionStore: mock };
});

// Mock icons
vi.mock('lucide-react', () => ({
  Play: () => <div data-testid="play" />,
  Pause: () => <div data-testid="pause" />,
  Calendar: () => <div data-testid="calendar" />,
  RotateCcw: () => <div data-testid="rotate-ccw" />,
}));

describe('TimeTravelControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    missionState.isLive = false;
  });

  it('calls handleGoLive when Live button is clicked', () => {
    render(<TimeTravelControls />);
    
    const liveButton = screen.getByText('Live');
    fireEvent.click(liveButton);
    
    expect(missionState.setIsLive).toHaveBeenCalledWith(true);
    expect(solarState.setCurrentTime).toHaveBeenCalledWith(new Date('2026-04-04T12:00:00Z'));
  });

  it('exits live mode when manual time travel is triggered (Play)', () => {
    missionState.isLive = true;
    
    render(<TimeTravelControls />);
    
    const playButton = screen.getByTestId('play');
    fireEvent.click(playButton);
    
    expect(missionState.setIsLive).toHaveBeenCalledWith(false);
    expect(solarState.setIsPlaying).toHaveBeenCalled();
  });

  it('exits live mode when jumping to a date', () => {
    missionState.isLive = true;
    
    render(<TimeTravelControls />);
    
    const jumpButton = screen.getByText('Jump');
    fireEvent.click(jumpButton);
    
    expect(missionState.setIsLive).toHaveBeenCalledWith(false);
    expect(solarState.setCurrentDate).toHaveBeenCalled();
  });
});
