import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PlanetInfo } from './PlanetInfo';
import type { SelectedPlanet } from '@/lib/types';

// Mock Lucide-react icons used in the component
vi.mock('lucide-react', () => {
  const MockIcon = () => <div data-testid="lucide-icon" />;

  return {
    Bot: MockIcon,
    ChevronDown: MockIcon,
    Compass: MockIcon,
    Gauge: MockIcon,
    Globe2: MockIcon,
    Info: MockIcon,
    Moon: MockIcon,
    Orbit: MockIcon,
    Ruler: MockIcon,
    Sparkles: MockIcon,
    Sun: MockIcon,
    Telescope: MockIcon,
    Thermometer: MockIcon,
    Timer: MockIcon,
    Waves: MockIcon,
  };
});

const mockEarthPosition = { x: 0, y: 0, z: 0 };

describe('PlanetInfo', () => {
  it('renders standard planet info correctly', () => {
    const mockPlanet: SelectedPlanet = {
      bodyId: '399', // Earth
      name: 'Terra',
      englishName: 'Earth',
      position: { x: 10, y: 0, z: 0 },
      velocity: { x: 0, y: 29.78, z: 0 },
      radius: 12.7,
      distanceFromSun: 149.6,
    };

    render(
      <PlanetInfo
        planet={mockPlanet}
        earthPosition={mockEarthPosition}
        onAskAstronomer={() => {}}
      />
    );

    expect(screen.getByText('Earth')).toBeInTheDocument();
    expect(screen.getByText('PLANET')).toBeInTheDocument();
    
    // Standard planet stats
    expect(screen.getAllByText('Distance from Sun').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Distance from Earth').length).toBeGreaterThan(0);
    expect(screen.getByText('Light time from Earth')).toBeInTheDocument();
  });

  it('renders moon specific info correctly', () => {
    const mockMoon: SelectedPlanet = {
      bodyId: '502', // Europa
      name: 'Europa',
      englishName: 'Europa',
      position: { x: 50, y: 0, z: 0 },
      velocity: { x: 0, y: 13.7, z: 0 },
      radius: 3,
      distanceFromSun: 778,
      parentId: '599',
      parentName: 'Jupiter',
      distanceToParentKm: 670900,
    };

    render(
      <PlanetInfo
        planet={mockMoon}
        earthPosition={mockEarthPosition}
        onAskAstronomer={() => {}}
      />
    );

    expect(screen.getByText('Europa')).toBeInTheDocument();
    // Subtitle should show it's a satellite
    expect(screen.getByText('Natural Satellite of Jupiter')).toBeInTheDocument();
    
    // Moon specific stats
    expect(screen.getAllByText('Distance to Jupiter').length).toBeGreaterThan(0);
    expect(screen.getAllByText('670,900').length).toBeGreaterThan(0); // Formatted distance
    
    // Moon metadata (from textureConfig mock/actual data)
    expect(screen.getByText('Surface / Composition')).toBeInTheDocument();
    expect(screen.getByText('Water Ice (subsurface ocean)')).toBeInTheDocument();
    expect(screen.getByText('Discovered by')).toBeInTheDocument();
    expect(screen.getByText('Galileo Galilei (1610)')).toBeInTheDocument();
  });

  it('calculates fallback velocity correctly when API velocity is missing', () => {
    const mockPlanetNoVelocity: SelectedPlanet = {
      bodyId: '499', // Mars
      name: 'Marte',
      englishName: 'Mars',
      position: { x: 20, y: 0, z: 0 },
      // No velocity property
      radius: 6.7,
      distanceFromSun: 227.9, 
    };

    render(
      <PlanetInfo
        planet={mockPlanetNoVelocity}
        earthPosition={mockEarthPosition}
        onAskAstronomer={() => {}}
      />
    );

    // Fallback formula: v = 2 * PI * R / T
    // Mars: distanceFromSun=227.9M km, orbitalPeriod=687 days
    // R = 227.9e6 km, T = 687 * 24 * 60 * 60 = 59356800 s
    // v = 2 * PI * 227.9e6 / 59356800 ≈ 24.13 km/s
    
    // The exact formatting might be '24.13' depending on formatNumber
    const expectedVelocityRegex = /24\.1/;
    
    // We look for the value near the label "Orbital Velocity"
    const statCards = screen.getAllByText(/Orbital Velocity/i);
    expect(statCards.length).toBeGreaterThan(0);
    
    // Try to find the calculated value
    expect(screen.getAllByText(expectedVelocityRegex).length).toBeGreaterThan(0);
  });

  it('switches to the AI Astronomer tab with contextual prompts', () => {
    const mockPlanet: SelectedPlanet = {
      bodyId: '699',
      name: 'Saturno',
      englishName: 'Saturn',
      position: { x: 100, y: 0, z: 0 },
      velocity: { x: 0, y: 9.7, z: 0 },
      radius: 60.2,
      distanceFromSun: 1420,
    };
    const onAskAstronomer = vi.fn();

    render(
      <PlanetInfo
        planet={mockPlanet}
        earthPosition={mockEarthPosition}
        onAskAstronomer={onAskAstronomer}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI Astronomer' }));

    expect(screen.getByText('Ask about Saturn')).toBeInTheDocument();
    expect(screen.getByText('Why are Saturns rings so bright?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open AI Astronomer' }));
    expect(onAskAstronomer).toHaveBeenCalledTimes(1);
  });
});
