import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimeTravelControls } from './TimeTravelControls';

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: T) => selector,
}));

// Mock the throttled display-time hook so ClockDisplay renders with a fixed date
// instead of requiring a live store or setInterval during tests.
vi.mock('@/hooks/useDisplayTime', () => ({
  useDisplayTime: () => new Date('2026-03-26T00:00:00.000Z'),
}));

const { solarState, missionState } = vi.hoisted(() => {
  return {
    solarState: {
      currentDate: '2026-03-26',
      currentTime: new Date('2026-03-26T00:00:00.000Z'),
      timeMultiplier: 60,
      isPlaying: false,
      setIsPlaying: vi.fn(),
      setCurrentDate: vi.fn(),
      setCurrentTime: vi.fn(),
      stepCurrentTimeByMs: vi.fn(),
      setTimeAuthority: vi.fn(),
      setTimeMultiplier: vi.fn(),
    },
    missionState: {
      isLive: false,
      liveTimestamp: '2026-04-04T12:00:00Z',
      setIsLive: vi.fn(),
    },
  };
});

vi.mock('@/store/solarStore', () => {
  const mock = vi.fn((selector) => (selector ? selector(solarState) : solarState));
  // @ts-expect-error Mocking the store object
  mock.getState = vi.fn(() => ({ currentTime: new Date('2026-03-26T00:00:00.000Z') }));
  return { useSolarStore: mock };
});

vi.mock('@/store/missionStore', () => {
  const mock = vi.fn((selector) => (selector ? selector(missionState) : missionState));
  return { useMissionStore: mock };
});

vi.mock('lucide-react', () => ({
  Play: () => <div data-testid="play" />,
  Pause: () => <div data-testid="pause" />,
  Calendar: () => <div data-testid="calendar" />,
  RotateCcw: () => <div data-testid="rotate-ccw" />,
  Rewind: () => <div data-testid="rewind" />,
  FastForward: () => <div data-testid="fast-forward" />,
}));

describe('TimeTravelControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    missionState.isLive = false;
    missionState.liveTimestamp = '2026-04-04T12:00:00Z';
  });

  it('calls handleGoLive when Live button is clicked', () => {
    render(<TimeTravelControls />);

    const liveButton = screen.getByText('Live');
    fireEvent.click(liveButton);

    expect(solarState.setIsPlaying).toHaveBeenCalledWith(false);
    expect(solarState.setTimeAuthority).toHaveBeenCalledWith('mission_live');
    expect(missionState.setIsLive).toHaveBeenCalledWith(true);
    expect(solarState.setCurrentTime).toHaveBeenCalledWith(new Date('2026-04-04T12:00:00Z'));
  });

  it('steps time backward with Back button', () => {
    render(<TimeTravelControls />);
    const backButton = screen.getByTitle('Back 15m');
    fireEvent.click(backButton);

    expect(solarState.setTimeAuthority).toHaveBeenCalledWith('user');
    expect(solarState.setIsPlaying).toHaveBeenCalledWith(false);
    expect(solarState.stepCurrentTimeByMs).toHaveBeenCalledWith(-900000);
  });

  it('steps time forward with Forward button', () => {
    render(<TimeTravelControls />);
    const forwardButton = screen.getByTitle('Forward 15m');
    fireEvent.click(forwardButton);

    expect(solarState.setTimeAuthority).toHaveBeenCalledWith('user');
    expect(solarState.setIsPlaying).toHaveBeenCalledWith(false);
    expect(solarState.stepCurrentTimeByMs).toHaveBeenCalledWith(900000);
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

  it('updates playback speed from the selector', () => {
    render(<TimeTravelControls />);

    const select = screen.getByTitle('Playback speed');
    fireEvent.change(select, { target: { value: '3600' } });

    expect(solarState.setTimeMultiplier).toHaveBeenCalledWith(3600);
  });

  it('reset uses the live timestamp when available', () => {
    render(<TimeTravelControls />);

    const resetButton = screen.getByTitle('Reset to Today');
    fireEvent.click(resetButton);

    expect(solarState.setIsPlaying).toHaveBeenCalledWith(false);
    expect(solarState.setCurrentTime).toHaveBeenCalledWith(new Date('2026-04-04T12:00:00Z'));
  });

  it('reset falls back to browser time when no live timestamp is available', () => {
    // Override liveTimestamp to null to exercise the browser-time fallback path.
    // This is an explicitly documented UX exception in the time-travel plan.
    missionState.liveTimestamp = null as unknown as string;

    render(<TimeTravelControls />);

    const resetButton = screen.getByTitle('Reset to Today');
    fireEvent.click(resetButton);

    expect(solarState.setIsPlaying).toHaveBeenCalledWith(false);
    expect(solarState.setCurrentTime).toHaveBeenCalled();
    const calledWith = solarState.setCurrentTime.mock.calls[0][0] as Date;
    expect(calledWith instanceof Date).toBe(true);
    expect(Number.isFinite(calledWith.getTime())).toBe(true);
  });
});
