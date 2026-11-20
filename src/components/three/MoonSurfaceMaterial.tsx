import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SRGBColorSpace, type Mesh } from 'three';
import { BasisTranscoderError, loadOptionalKTX2Texture } from '@/lib/SingletonKTX2Loader';
import { useTexturePromotion } from '@/hooks/useTexturePromotion';
import type { TextureTier } from '@/lib/textureConfig';

interface MoonSurfaceMaterialProps {
  name: string;
  textureUrl: string;
  fallbackColor: string;
  meshRef: React.RefObject<Mesh | null>;
  maxTier: TextureTier;
}

export function MoonSurfaceMaterial({ name, textureUrl, fallbackColor, meshRef, maxTier }: MoonSurfaceMaterialProps) {
  const gl = useThree(state => state.gl);
  const { data, errorUpdateCount, isError, isFetching, refetch } = useQuery({
    queryKey: ['moon-texture', textureUrl],
    queryFn: () => loadOptionalKTX2Texture(gl, textureUrl),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    retryOnMount: false,
    networkMode: 'always',
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    throwOnError: error => error instanceof BasisTranscoderError,
  });

  const colorTexture = useMemo(() => {
    if (!data) return null;
    const texture = data.clone();
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [data]);
  const promotedTexture = useTexturePromotion(meshRef, textureUrl, maxTier);
  const visibleTexture = promotedTexture ?? colorTexture;

  useEffect(() => () => colorTexture?.dispose(), [colorTexture]);

  useEffect(() => {
    if (!isError || isFetching) return;
    const id = toast.warning(`Texture unavailable for ${name}`, {
      description: 'Showing the surface in a solid color.',
      duration: Infinity,
      closeButton: true,
      action: {
        label: 'Retry texture',
        onClick: () => { void refetch({ cancelRefetch: false }); },
      },
    });
    return () => { toast.dismiss(id); };
  }, [errorUpdateCount, isError, isFetching, name, refetch]);

  return (
    <meshStandardMaterial
      key={visibleTexture ? 'textured' : 'solid'}
      map={visibleTexture}
      color={visibleTexture ? '#ffffff' : fallbackColor}
    />
  );
}
