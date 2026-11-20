import { describe, it, expect, vi } from 'vitest';
import textureLock from '../../assets/textures.lock.json';
import recoveredInventory from '../../assets/recovered-inventory.json';

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
      const europa = PLANET_CONFIG['502'];
      const titan = PLANET_CONFIG['606'];
      expect(europa.texturePaths.low).toContain('/europa_low.ktx2');
      expect(titan.texturePaths.low).toContain('/titan_low.ktx2');
      expect(europa.surfaceTextureNote).toMatch(/Approximate surface appearance/);
      expect(titan.surfaceTextureNote).toMatch(/source attribution.*unknown/i);
      const hashes = (recoveredInventory.textures as Array<{ path: string; sha256: string }>)
        .reduce<Record<string, string>>((byPath, file) => ({ ...byPath, [file.path]: file.sha256 }), {});
      for (const tier of ['low', 'mid', 'high']) {
        expect(hashes[`europa_${tier}.ktx2`]).toBe(hashes[`titan_${tier}.ktx2`]);
      }
    } finally { vi.unstubAllEnvs(); }
  });
});
