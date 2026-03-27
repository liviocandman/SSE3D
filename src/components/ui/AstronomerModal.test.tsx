import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AstronomerModal } from './AstronomerModal';
import type { SelectedPlanet } from '@/lib/types';

// Mock dependencies
vi.mock('lucide-react', () => ({
  X: () => <div data-testid="x-icon" />,
  Send: () => <div data-testid="send-icon" />,
  Bot: () => <div data-testid="bot-icon" />,
  User: () => <div data-testid="user-icon" />,
  Trash2: () => <div data-testid="trash-icon" />,
}));

vi.mock('@/hooks/useAstronomer', () => ({
  useAstronomer: () => ({
    messages: [],
    isLoading: false,
    sendMessage: vi.fn(),
    clearHistory: vi.fn(),
  }),
}));

vi.mock('@/store/solarStore', () => ({
  useSolarStore: <T,>(selector: (state: { currentDate: string }) => T): T =>
    selector({ currentDate: '2026-03-25' }),
}));

function createPlanet(overrides: Partial<SelectedPlanet>): SelectedPlanet {
  return {
    bodyId: '499',
    name: 'Mars',
    englishName: 'Mars',
    position: { x: 0, y: 0, z: 0 },
    radius: 1,
    distanceFromSun: 227.9,
    ...overrides,
  };
}

describe('AstronomerModal', () => {
  it('renders standard planet context correctly', () => {
    const mockPlanet = createPlanet({ bodyId: '499', englishName: 'Mars' });

    render(
      <AstronomerModal
        isOpen={true}
        onClose={() => {}}
        planet={mockPlanet}
        currentDate="2026-03-25"
      />
    );

    expect(screen.getByText('Mars • 2026-03-25')).toBeInTheDocument();
  });

  it('renders moon context correctly with parent name', () => {
    const mockMoon = createPlanet({
      bodyId: '502',
      name: 'Europa',
      englishName: 'Europa',
      parentName: 'Jupiter',
    });

    render(
      <AstronomerModal
        isOpen={true}
        onClose={() => {}}
        planet={mockMoon}
        currentDate="2026-03-25"
      />
    );

    expect(screen.getByText('Europa • Satélite de Jupiter • 2026-03-25')).toBeInTheDocument();
  });
});
