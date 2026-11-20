import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SRGBColorSpace } from 'three';
import { BasisTranscoderError, loadOptionalKTX2Texture } from '@/lib/SingletonKTX2Loader';

interface MoonSurfaceMaterialProps {
  name: string;
  textureUrl: string;
  fallbackColor: string;
}

export function MoonSurfaceMaterial({ name, textureUrl, fallbackColor }: MoonSurfaceMaterialProps) {
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

  // Switching map presence changes the program. Replace the material only,
  // keeping the mesh, its position and its pointer interactions.
  return (
    <meshStandardMaterial
      key={colorTexture ? 'textured' : 'solid'}
      map={colorTexture}
      color={colorTexture ? '#ffffff' : fallbackColor}
    />
  );
}
