import { describe, it, expect } from 'vitest';
import { PLANET_CONFIG, PLANET_MOONS, getPlanetConfig } from './textureConfig';

describe('textureConfig', () => {
  describe('PLANET_MOONS mapping', () => {
    it('should map Earth (399) to Moon (301)', () => {
      expect(PLANET_MOONS['399']).toContain('301');
    });

    it('should map Jupiter (599) to its 4 Galilean moons', () => {
      const jupiterMoons = PLANET_MOONS['599'];
      expect(jupiterMoons).toHaveLength(4);
      expect(jupiterMoons).toContain('501'); // Io
      expect(jupiterMoons).toContain('502'); // Europa
      expect(jupiterMoons).toContain('503'); // Ganymede
      expect(jupiterMoons).toContain('504'); // Callisto
    });
  });

  describe('Moon Configurations', () => {
    it('should have moon-specific properties for Europa', () => {
      const europa = getPlanetConfig('502');
      expect(europa).toBeDefined();
      expect(europa?.type).toBe('MOON');
      expect(europa?.bodyClass).toBe('MOON');
      expect(europa?.surfaceType).toBeDefined();
      expect(europa?.discoverer).toBeDefined();
    });

    it('should have valid fallback colors and textures for moons', () => {
      const moonIds = Object.values(PLANET_MOONS).flat();
      moonIds.forEach(moonId => {
        const config = getPlanetConfig(moonId);
        expect(config).toBeDefined();
        expect(config?.fallbackColor).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(config?.texturePaths.mid).toContain('.webp');
      });
    });
  });
});
