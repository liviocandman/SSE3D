import { describe, it, expect, vi } from 'vitest';

// Hoist safety for Next.js 15+ internal config checks
vi.mock('next/config', () => ({
  default: () => ({ publicRuntimeConfig: {}, serverRuntimeConfig: {} }),
  getConfig: () => ({ publicRuntimeConfig: {}, serverRuntimeConfig: {} }),
}));
// @ts-expect-error - Global config is not defined in standard Node/TS typings
global.config = global.config || {};


import { render, screen, fireEvent } from '@testing-library/react';
import { HUD } from './HUD';

import type { HTMLAttributes, ReactNode } from 'react';

type MockMotionDivProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
  'data-testid'?: string;
};

// Mock framer-motion to bypass animation delays in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      className,
      'data-testid': dataTestId,
      ...props
    }: MockMotionDivProps) => (
      <div className={className} data-testid={dataTestId} {...props}>
        {children}
      </div>
    ),
  },
}));

// Mock hooks and stores
const mockSolarState = {
  selectedPlanet: { bodyId: '399', englishName: 'Earth' },
  currentDate: '2026-03-26',
  currentTime: new Date('2026-03-26T00:00:00.000Z'),
  viewMode: 'didactic' as const,
  timeMultiplier: 1,
  isPlaying: false,
  toggleViewMode: vi.fn(),
  setIsPlaying: vi.fn(),
  setTimeMultiplier: vi.fn(),
  setCurrentDate: vi.fn(),
};

vi.mock('@/store/solarStore', () => ({
  useSolarStore: (selector?: (state: typeof mockSolarState) => unknown) =>
    selector ? selector(mockSolarState) : mockSolarState,
}));

const mockUIState = {
  isMobile: false,
  openFavorites: vi.fn(),
};

vi.mock('@/store/uiStore', () => ({
  useUIStore: (selector?: (state: typeof mockUIState) => unknown) =>
    selector ? selector(mockUIState) : mockUIState,
}));

vi.mock('@/hooks/useFavorites', () => ({
  useFavorites: () => ({
    favorites: [],
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
    isFavorite: () => false,
  }),
}));

// Mock sub-components
vi.mock('./PlanetInfo', () => ({ PlanetInfo: () => <div data-testid="planet-info" /> }));
vi.mock('./DateSelector', () => ({ DateSelector: () => <div data-testid="date-selector" /> }));
vi.mock('./AstronomerModal', () => ({ AstronomerModal: () => <div data-testid="astronomer-modal" /> }));
vi.mock('./AuthModal', () => ({ AuthModal: () => <div data-testid="auth-modal" /> }));
vi.mock('./FavoritesModal', () => ({ FavoritesModal: () => <div data-testid="favorites-modal" /> }));

// Mock icons
vi.mock('lucide-react', () => ({
  ChevronLeft: () => <div data-testid="chevron-left" />,
  ChevronRight: () => <div data-testid="chevron-right" />,
  Heart: () => <div data-testid="heart" />,
  Telescope: () => <div data-testid="telescope" />,
  Calendar: () => <div data-testid="calendar" />,
  Clock: () => <div data-testid="clock" />,
  Play: () => <div data-testid="play" />,
  Pause: () => <div data-testid="pause" />,
  FastForward: () => <div data-testid="fast-forward" />,
  Rewind: () => <div data-testid="rewind" />,
  RotateCcw: () => <div data-testid="rotate-ccw" />,
  Menu: () => <div data-testid="menu" />,
  LogOut: () => <div data-testid="logout" />,
  User: () => <div data-testid="user" />,
}));

describe('HUD', () => {
  it('toggles minimize state when clicking the control tab', () => {
    render(<HUD onDateChange={vi.fn()} />);

    // In a non-minimized state (default on desktop with a selected planet), we should see ChevronRight
    const toggleButton = screen.getByTitle('Hide panel');
    expect(toggleButton).toBeInTheDocument();
    
    // It should initially render with x: 0 (from our mocked framer-motion, we can't easily check the inline style if we strip it, but we can check the icon change)
    expect(screen.getByTestId('chevron-right')).toBeInTheDocument();

    // Click to minimize
    fireEvent.click(toggleButton);

    // After clicking, title should change and ChevronLeft should appear
    expect(screen.getByTitle('Show panel')).toBeInTheDocument();
    expect(screen.getByTestId('chevron-left')).toBeInTheDocument();
  });
});
