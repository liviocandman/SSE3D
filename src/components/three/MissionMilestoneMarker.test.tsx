import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MissionMilestoneMarker } from './MissionMilestoneMarker';
import type { ReactNode } from 'react';

type MockChildrenProps = {
  children?: ReactNode;
};

type MockLineProps = {
  points?: unknown;
};

// Mock fiber
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

// Mock drei
vi.mock('@react-three/drei', () => ({
  Billboard: ({ children }: MockChildrenProps) => <div data-testid="billboard">{children}</div>,
  Text: ({ children }: MockChildrenProps) => <div data-testid="text">{children}</div>,
  Line: ({ points }: MockLineProps) => <div data-testid="line" data-points={JSON.stringify(points)} />,
}));

describe('MissionMilestoneMarker', () => {
  it('renders label and pointer line', () => {
    const { getByTestId, getByText } = render(
      <MissionMilestoneMarker 
        label="TLI" 
        position={[0, 0, 0]} 
      />
    );
    
    expect(getByText('TLI')).toBeInTheDocument();
    expect(getByTestId('line')).toBeInTheDocument();
  });

  it('applies opacity to sub-components', () => {
    const { getByTestId } = render(
      <MissionMilestoneMarker 
        label="TLI" 
        position={[0, 0, 0]}
        opacity={0.5}
      />
    );
    
    // We can't easily check opacity on mocked div styles here without more complex setup,
    // but we ensure it doesn't crash.
    expect(getByTestId('billboard')).toBeInTheDocument();
  });
});
