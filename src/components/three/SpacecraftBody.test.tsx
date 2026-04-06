import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SpacecraftBody } from './SpacecraftBody';

type MockCanvasProps = { children?: React.ReactNode };

// Mock Three
vi.mock('three', () => {
  return {
    Group: class {},
    Mesh: class {},
    Sprite: class {},
    Quaternion: class {
      x = 0;
      y = 0;
      z = 0;
      w = 1;
      setFromEuler() { return this; }
      set(x: number, y: number, z: number, w: number) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        return this;
      }
      normalize() { return this; }
      multiply() { return this; }
      copy() { return this; }
    },
    Euler: class {
      constructor(public x: number, public y: number, public z: number) {}
    },
    Vector3: class {
      x = 0;
      y = 0;
      z = 0;
      set(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
      }
    },
    PerspectiveCamera: class {},
    Texture: class {},
    CanvasTexture: class {},
    MathUtils: {
      degToRad: (value: number) => (value * Math.PI) / 180,
      clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    },
    DoubleSide: 2,
  };
});

// Mock fiber
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  Canvas: ({ children }: MockCanvasProps) => <div data-testid="canvas">{children}</div>,
}));

// Mock drei
vi.mock('@react-three/drei', () => ({
  Html: ({ children }: MockCanvasProps) => <div data-testid="html">{children}</div>,
}));

describe('SpacecraftBody', () => {
  it('renders label and marker by default', () => {
    const { getByTestId, getByText } = render(
      <SpacecraftBody
        vehicleId="orion"
        label="Orion Label"
        position={[0, 0, 0]}
        isSelected={false}
        onClick={vi.fn()}
      />
    );
    
    // Check label renders
    expect(getByText('Orion Label')).toBeInTheDocument();
    
    // Ensure the HTML container renders
    expect(getByTestId('html')).toBeInTheDocument();
  });

  it('calls onClick with vehicleId when clicked and makes a meaningful assertion', () => {
    const handleClick = vi.fn();
    const { container } = render(
      <SpacecraftBody
        vehicleId="orion"
        label="Orion Label"
        position={[0, 0, 0]}
        isSelected={false}
        onClick={handleClick}
      />
    );
    
    // We expect the group to exist in test dom
    const group = container.querySelector('group');
    expect(group).not.toBeNull();
    
    // Fire click and definitively expect handler to have been called
    fireEvent.click(group!);
    expect(handleClick).toHaveBeenCalledWith('orion');
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
