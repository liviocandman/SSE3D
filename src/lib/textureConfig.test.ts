import { describe, it, expect, vi } from 'vitest';
import textureLock from '../../assets/textures.lock.json';

describe('versioned texture origins', () => {
  it('uses the lock for every tier, including generic moons, regardless of legacy CDN env', async () => {
    vi.stubEnv('NEXT_PUBLIC_TEXTURE_CDN_URL', 'https://legacy.invalid');
    try {
      const { PLANET_CONFIG, TEXTURE_BASE, getGenericMoonTexture } = await import('./textureConfig');
      expect(TEXTURE_BASE).toBe(`/textures/${textureLock.current.version}`);
      for (const config of Object.values(PLANET_CONFIG)) {
        for (const [tier, url] of Object.entries(config.texturePaths)) {
          expect(url).toMatch(new RegExp(`^${TEXTURE_BASE}/[a-z_]+_${tier}\\.ktx2$`));
        }
      }
      for (const tier of ['low', 'mid', 'high'] as const) expect(getGenericMoonTexture(tier)).toBe(`${TEXTURE_BASE}/generic_moon_${tier}.ktx2`);
      expect(getGenericMoonTexture()).toBe(getGenericMoonTexture('mid'));
    } finally { vi.unstubAllEnvs(); }
  });
});
