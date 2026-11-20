import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneErrorBoundary } from './SceneErrorBoundary';

function BrokenScene({ message }: { message: string }): never {
  throw new Error(message);
}

describe('SceneErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['Could not load /textures/earth.ktx2', 'Texture Load Error'],
    ['Unable to initialize renderer', '3D Scene Unavailable'],
  ])('offers recovery when the scene fails: %s', (message, title) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    render(<SceneErrorBoundary onError={onError}><BrokenScene message={message} /></SceneErrorBoundary>);
    expect(screen.getByRole('heading', { name: title })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Manual Refresh' })).toBeEnabled();
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ technicalDetails: message }));
  });
});
