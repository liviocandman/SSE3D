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

const { solarState } = vi.hoisted(() => {
  return {
    solarState: {
      currentDate: '2026-03-26',
      currentTime: new Date('2026-03-26T00:00:00.000Z'),
      timeMultiplier: 60,
      isPlaying: false,
      togglePlaybackIntent: vi.fn(),
      stepByMsIntent: vi.fn(),
      jumpToDateUtcIntent: vi.fn(),
      resetToAnchorIntent: vi.fn(),
      setTimeMultiplier: vi.fn(),
    },
  };
});

vi.mock('@/store/solarStore', () => {
  const mock = vi.fn((selector) => (selector ? selector(solarState) : solarState));
  // @ts-expect-error Mocking the store object
  mock.getState = vi.fn(() => ({ currentTime: new Date('2026-03-26T00:00:00.000Z') }));
  return { useSolarStore: mock };
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
  });

  it('resets to the current browser time from the Now button', () => {
    render(<TimeTravelControls />);

    fireEvent.click(screen.getByText('Now'));

    expect(solarState.resetToAnchorIntent).toHaveBeenCalledWith();
  });

  it('steps time backward with Back button', () => {
    render(<TimeTravelControls />);
    const backButton = screen.getByTitle('Back 15m');
    fireEvent.click(backButton);

    expect(solarState.stepByMsIntent).toHaveBeenCalledWith(-900000);
  });

  it('steps time forward with Forward button', () => {
    render(<TimeTravelControls />);
    const forwardButton = screen.getByTitle('Forward 15m');
    fireEvent.click(forwardButton);

    expect(solarState.stepByMsIntent).toHaveBeenCalledWith(900000);
  });

  it('toggles playback when Play is clicked', () => {
    render(<TimeTravelControls />);

    const playButton = screen.getByTestId('play');
    fireEvent.click(playButton);

    expect(solarState.togglePlaybackIntent).toHaveBeenCalled();
  });

  it('jumps to a selected date', () => {
    render(<TimeTravelControls />);

    const jumpButton = screen.getByText('Jump');
    fireEvent.click(jumpButton);

    expect(solarState.jumpToDateUtcIntent).toHaveBeenCalledWith('2026-03-26');
  });

  it('updates playback speed from the selector', () => {
    render(<TimeTravelControls />);

    const select = screen.getByTitle('Playback speed');
    fireEvent.change(select, { target: { value: '3600' } });

    expect(solarState.setTimeMultiplier).toHaveBeenCalledWith(3600);
  });

  it('reset uses browser time', () => {
    render(<TimeTravelControls />);

    const resetButton = screen.getByTitle('Reset to Today');
    fireEvent.click(resetButton);

    expect(solarState.resetToAnchorIntent).toHaveBeenCalledWith();
  });
});
