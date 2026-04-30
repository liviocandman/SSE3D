import { useMemo } from 'react';
import type { EphemerisData } from '@/lib/types';
import type { BodyClass, ViewMode } from '@/lib/scales';
import { getPlanetConfig, getTexturePath, type TextureTier } from '@/lib/textureConfig';
import { getRadius, scalePositionFromKm, KM_TO_UNIT } from '@/lib/scales';

const SUN_BODY_ID = '10';

const SEGMENTS_BY_TIER: Record<string, number> = {
  high: 64,
  mid: 48,
  low: 24,
};

function calculateMillionKmFromSun(position: [number, number, number]): number {
  const [x, y, z] = position;
  return Math.sqrt(x * x + y * y + z * z) * KM_TO_UNIT;
}

export { SUN_BODY_ID, calculateMillionKmFromSun };

export interface PlanetRenderData {
  bodyId: string;
  name: string;
  englishName: string;
  position: [number, number, number];
  velocity: EphemerisData['velocity'];
  trajectory: EphemerisData['trajectory'];
  radius: number;
  texturePath: string;
  rotationSpeed: number;
  axialTilt: number;
  dayLength: number;
  distanceFromSun: number;
  bodyClass: BodyClass;
  segments: number;
}

export function usePlanetsToRender(
  ephemerisData: EphemerisData[] | undefined,
  tier: string,
  viewMode: ViewMode,
) {
  const planetsToRender = useMemo((): PlanetRenderData[] => {
    if (!ephemerisData || ephemerisData.length === 0) {
      return [];
    }

    const segments = SEGMENTS_BY_TIER[tier] ?? 48;

    return ephemerisData
      .filter(body => body.bodyId !== SUN_BODY_ID)
      .map(body => {
        const config = getPlanetConfig(body.bodyId);
        if (!config) return null;

        const position = scalePositionFromKm(
          body.position.x,
          body.position.y,
          body.position.z
        );

        return {
          bodyId: body.bodyId,
          name: config.name,
          englishName: config.englishName,
          position,
          velocity: body.velocity,
          trajectory: body.trajectory,
          radius: getRadius(body.bodyId, config.bodyClass, viewMode),
          texturePath: getTexturePath(body.bodyId, tier as TextureTier),
          rotationSpeed: config.rotationSpeed,
          axialTilt: config.axialTilt,
          dayLength: config.dayLength,
          distanceFromSun: calculateMillionKmFromSun([
            body.position.x,
            body.position.y,
            body.position.z,
          ]),
          bodyClass: config.bodyClass,
          segments,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [ephemerisData, tier, viewMode]);

  const ephemerisById = useMemo(() => {
    const map: Record<string, EphemerisData> = {};
    if (!ephemerisData) return map;
    for (const body of ephemerisData) {
      map[body.bodyId] = body;
    }
    return map;
  }, [ephemerisData]);

  return { planetsToRender, ephemerisById };
}
