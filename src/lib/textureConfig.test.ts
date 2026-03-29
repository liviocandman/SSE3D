import { describe, it, expect } from 'vitest';
import { PLANET_MOONS, getPlanetConfig } from './textureConfig';

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
        expect(config?.texturePaths.mid).toContain('.ktx2');
      });
    });
  });

  describe('Axial Tilt and Day Length', () => {
    const planetIds = ['199', '299', '399', '499', '599', '699', '799', '899', '999'];
    
    planetIds.forEach(id => {
      it(`should have axialTilt and dayLength for ${id}`, () => {
        const config = getPlanetConfig(id);
        expect(config).toBeDefined();
        expect(typeof config?.axialTilt).toBe('number');
        expect(typeof config?.dayLength).toBe('number');
        expect(config?.dayLength).not.toBe(0);
      });
    });

    it('should have negative dayLength for retrograde planets', () => {
      const venus = getPlanetConfig('299');
      const uranus = getPlanetConfig('799');
      const pluto = getPlanetConfig('999');

      expect(venus?.dayLength).toBeLessThan(0);
      expect(uranus?.dayLength).toBeLessThan(0);
      expect(pluto?.dayLength).toBeLessThan(0);
    });

    it('should have high axial tilt for Uranus and Pluto', () => {
      const uranus = getPlanetConfig('799');
      const pluto = getPlanetConfig('999');

      expect(uranus?.axialTilt).toBeGreaterThan(90);
      expect(pluto?.axialTilt).toBeGreaterThan(90);
    });
  });
});
