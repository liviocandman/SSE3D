import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { markEssentialTextureReady } from '@/lib/textureReadiness';
import { useLoadingProgress } from './useLoadingProgress';

it('waits for the rendered essential maps and stays ready while ephemerides refetch', () => {
  const bodyIds = ['399', '499', '999'];
  const { result, rerender } = renderHook(
    ({ fetching }) => useLoadingProgress({ isApiLoading: fetching, hasApiData: true, bodyIds }),
    { initialProps: { fetching: false } },
  );

  expect(result.current).toMatchObject({ stage: 'loading_textures', texturesLoaded: 0, texturesTotal: 3 });
  act(() => {
    markEssentialTextureReady('10');
    markEssentialTextureReady('399');
    markEssentialTextureReady('999');
  });
  expect(result.current).toMatchObject({ stage: 'loading_textures', texturesLoaded: 2, texturesTotal: 3 });
  act(() => markEssentialTextureReady('499'));
  expect(result.current).toMatchObject({ stage: 'ready', texturesLoaded: 3, progress: 100 });

  rerender({ fetching: true });
  expect(result.current.stage).toBe('ready');
});
