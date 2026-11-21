'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useQuery } from '@tanstack/react-query';
import * as THREE from 'three';
import { loadOptionalKTX2Texture } from '@/lib/SingletonKTX2Loader';
import type { TextureTier } from '@/lib/textureConfig';

const TIER_ORDER: Record<TextureTier, number> = { low: 0, mid: 1, high: 2 };

/** Resolves to an owned promoted texture only when the visible body needs more pixels. */
export function useTexturePromotion(
  meshRef: React.RefObject<THREE.Mesh | null>,
  lowTextureUrl: string,
  maxTier: TextureTier,
): THREE.Texture | null {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const [desiredTier, setDesiredTier] = useState<TextureTier>('low');
  const desiredTierRef = useRef<TextureTier>('low');
  const frameCount = useRef(0);
  const sphere = useRef(new THREE.Sphere());
  const viewCenter = useRef(new THREE.Vector3());
  const frustum = useRef(new THREE.Frustum());
  const projectionView = useRef(new THREE.Matrix4());
  const worldScale = useRef(new THREE.Vector3());

  useFrame(() => {
    if (++frameCount.current % 12 !== 0) return;
    const mesh = meshRef.current;
    if (!mesh || !mesh.visible || !lowTextureUrl.endsWith('_low.ktx2')) return;
    for (let ancestor: THREE.Object3D | null = mesh; ancestor; ancestor = ancestor.parent) {
      if (!ancestor.visible) return;
    }

    camera.updateMatrixWorld();
    mesh.updateWorldMatrix(true, false);
    mesh.getWorldPosition(sphere.current.center);
    const geometry = mesh.geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    if (!geometry.boundingSphere) return;
    mesh.getWorldScale(worldScale.current);
    sphere.current.radius = geometry.boundingSphere.radius * Math.max(worldScale.current.x, worldScale.current.y, worldScale.current.z);
    projectionView.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.current.setFromProjectionMatrix(projectionView.current);
    if (!frustum.current.intersectsSphere(sphere.current)) return;

    viewCenter.current.copy(sphere.current.center).applyMatrix4(camera.matrixWorldInverse);
    const depth = -viewCenter.current.z;
    if (depth <= 0) return;
    const projectedDiameter = camera instanceof THREE.PerspectiveCamera
      ? sphere.current.radius * size.height / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth)
      : camera instanceof THREE.OrthographicCamera
        ? 2 * sphere.current.radius * size.height / Math.max(camera.top - camera.bottom, 1e-6)
        : 0;

    const nextTier: TextureTier = maxTier === 'high' && projectedDiameter >= 512
      ? 'high'
      : maxTier !== 'low' && projectedDiameter >= 128 ? 'mid' : 'low';
    if (TIER_ORDER[nextTier] > TIER_ORDER[desiredTierRef.current]) {
      desiredTierRef.current = nextTier;
      setDesiredTier(nextTier);
    }
  });

  const midUrl = lowTextureUrl.replace('_low.ktx2', '_mid.ktx2');
  const highUrl = lowTextureUrl.replace('_low.ktx2', '_high.ktx2');
  const midQuery = useQuery({
    queryKey: ['optional-planet-texture', midUrl],
    queryFn: () => loadOptionalKTX2Texture(gl, midUrl),
    enabled: desiredTier === 'mid',
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });
  const highQuery = useQuery({
    queryKey: ['optional-planet-texture', highUrl],
    queryFn: () => loadOptionalKTX2Texture(gl, highUrl),
    enabled: desiredTier === 'high',
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });
  const sourceTexture = desiredTier === 'high'
    ? highQuery.data ?? midQuery.data
    : desiredTier === 'mid' ? midQuery.data : undefined;
  const texture = useMemo(() => sourceTexture?.clone() ?? null, [sourceTexture]);
  const disposalEpoch = useRef(new WeakMap<THREE.Texture, number>());

  useEffect(() => {
    if (!texture) return;
    const epochs = disposalEpoch.current;
    const epoch = (epochs.get(texture) ?? 0) + 1;
    epochs.set(texture, epoch);
    return () => {
      queueMicrotask(() => {
        if (epochs.get(texture) === epoch) texture.dispose();
      });
    };
  }, [texture]);

  useEffect(() => {
    if (midQuery.isError) console.warn(`[TexturePromotion] Optional mid map failed; keeping low texture: ${midUrl}`);
    if (highQuery.isError) console.warn(`[TexturePromotion] Optional high map failed; keeping the last available texture: ${highUrl}`);
  }, [highQuery.isError, highUrl, midQuery.isError, midUrl]);

  return texture;
}
