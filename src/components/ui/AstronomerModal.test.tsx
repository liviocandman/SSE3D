import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AstronomerModal } from './AstronomerModal';

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
  useSolarStore: (selector: any) => selector({ currentDate: '2026-03-25' }),
}));

describe('AstronomerModal', () => {
  it('renders standard planet context correctly', () => {
    const mockPlanet = {
      bodyId: '499',
      englishName: 'Mars',
      // No parentId/parentName
    };

    render(
      <AstronomerModal
        isOpen={true}
        onClose={() => {}}
        planet={mockPlanet as any}
        currentDate="2026-03-25"
      />
    );

    expect(screen.getByText('Mars • 2026-03-25')).toBeInTheDocument();
  });

  it('renders moon context correctly with parent name', () => {
    const mockMoon = {
      bodyId: '502',
      englishName: 'Europa',
      parentName: 'Jupiter',
    };

    render(
      <AstronomerModal
        isOpen={true}
        onClose={() => {}}
        planet={mockMoon as any}
        currentDate="2026-03-25"
      />
    );

    expect(screen.getByText('Europa • Satélite de Jupiter • 2026-03-25')).toBeInTheDocument();
  });
});
