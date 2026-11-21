import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist safety for Next.js 15+ internal config checks
vi.mock('next/config', () => ({
  default: () => ({ publicRuntimeConfig: {}, serverRuntimeConfig: {} }),
  getConfig: () => ({ publicRuntimeConfig: {}, serverRuntimeConfig: {} }),
}));
// @ts-expect-error - Global config is not defined in standard Node/TS typings
global.config = global.config || {};


import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HUD } from './HUD';

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: T) => selector,
}));

// Setup hoisted mocks
const { solarState } = vi.hoisted(() => {
  return {
    solarState: {
      selectedPlanet: { bodyId: '399', englishName: 'Earth' } as { bodyId: string; englishName: string } | null,
      currentDate: '2026-03-26',
      currentTime: new Date('2026-03-26T00:00:00.000Z'),
      masterTrajectorySegments: {},
      baseTrajectorySegments: {},
      viewMode: 'didactic' as const,
      isPlaying: false,
      toggleViewMode: vi.fn(),
      setIsPlaying: vi.fn(),
      setCurrentDate: vi.fn(),
      setSelectedPlanet: vi.fn(),
      setTravelTarget: vi.fn(),
      advanceTime: vi.fn(),
    },
  };
});

vi.mock('@/store/solarStore', () => {
  const mock = vi.fn((selector) => selector ? selector(solarState) : solarState);
  // @ts-expect-error - Mocking the store object
  mock.getState = vi.fn(() => solarState);
  return { useSolarStore: mock };
});

const mockUIState = {
  isFavoritesOpen: false,
  isAuthModalOpen: false,
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
vi.mock('./PlanetInfo', () => ({
  PlanetInfo: ({ onAskAstronomer }: { onAskAstronomer?: () => void }) => (
    <button data-testid="planet-info" onClick={onAskAstronomer}>Ask astronomer</button>
  ),
}));
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
  beforeEach(() => {
    vi.clearAllMocks();
    window.innerWidth = 1024;
    mockUIState.isFavoritesOpen = false;
    mockUIState.isAuthModalOpen = false;
    solarState.selectedPlanet = { bodyId: '399', englishName: 'Earth' };
  });

  it('toggles minimize state when clicking the control tab', () => {
    render(<HUD />);

    const toggleButton = screen.getByTitle('Hide panel');
    expect(toggleButton).toBeInTheDocument();
    expect(screen.getByTestId('chevron-right')).toBeInTheDocument();

    fireEvent.click(toggleButton);

    expect(screen.getByTitle('Show panel')).toBeInTheDocument();
    expect(screen.getByTestId('chevron-left')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Show panel'));

    expect(screen.getByTitle('Hide panel')).toBeInTheDocument();
  });

  it('mounts each optional dialog only after its first open request', async () => {
    const { rerender } = render(<HUD />);
    expect(screen.queryByTestId('favorites-modal')).toBeNull();
    expect(screen.queryByTestId('auth-modal')).toBeNull();
    expect(screen.queryByTestId('astronomer-modal')).toBeNull();

    mockUIState.isFavoritesOpen = true;
    rerender(<HUD />);
    expect(await screen.findByTestId('favorites-modal')).toBeInTheDocument();

    mockUIState.isFavoritesOpen = false;
    mockUIState.isAuthModalOpen = true;
    rerender(<HUD />);
    expect(await screen.findByTestId('auth-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('favorites-modal')).toBeNull();

    mockUIState.isAuthModalOpen = false;
    rerender(<HUD />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask astronomer' }));
    expect(await screen.findByTestId('astronomer-modal')).toBeInTheDocument();
  });

  it('renders PlanetInfo by default when a planet is selected', () => {
    render(<HUD />);
    expect(screen.getByTestId('planet-info')).toBeInTheDocument();
  });

  it.each([390, 1024])('shows the degraded data notice and clears it after recovery at width %i', (width) => {
    window.innerWidth = width;
    const { rerender } = render(<HUD isFallback />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Algumas posições usam dados de referência e podem não representar a data selecionada.',
    );
    expect(screen.getAllByText(/Dados degradados/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Offline')).not.toBeInTheDocument();
    rerender(<HUD isFallback={false} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/Dados degradados/)).not.toBeInTheDocument();
  });

  it('reopens the minimized drawer when a different planet is selected', async () => {
    const { rerender } = render(<HUD />);
    fireEvent.click(screen.getByTitle('Hide panel'));
    expect(screen.getByTitle('Show panel')).toBeInTheDocument();

    solarState.selectedPlanet = { bodyId: '499', englishName: 'Mars' };
    rerender(<HUD />);

    await waitFor(() => expect(screen.getByTitle('Hide panel')).toBeInTheDocument());
  });

  it('expands the mobile panel from the planetary preview without mission controls', () => {
    window.innerWidth = 390;
    solarState.selectedPlanet = null;
    const { rerender } = render(<HUD />);
    expect(screen.getByText('Tap to explore')).toBeInTheDocument();

    solarState.selectedPlanet = { bodyId: '399', englishName: 'Earth' };
    rerender(<HUD />);
    fireEvent.click(screen.getByText('Earth'));

    expect(screen.queryByText('Tap to explore')).not.toBeInTheDocument();
    expect(screen.getByTestId('planet-info')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mission/i })).not.toBeInTheDocument();
  });
});
