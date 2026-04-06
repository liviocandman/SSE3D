import { describe, it, expect } from 'vitest';
import { getMoonOrbitScale, MOON_ORBIT_PADDING, getRadius, KM_TO_UNIT, SPACECRAFT_RADIUS_KM } from './scales';

describe('scales', () => {
  describe('getRadius - SPACECRAFT', () => {
    it('should handle SPACECRAFT body class in didactic mode without inflating', () => {
      const radius = getRadius('orion', 'SPACECRAFT', 'didactic');
      expect(radius).toBe(SPACECRAFT_RADIUS_KM * KM_TO_UNIT);
    });

    it('should handle SPACECRAFT body class in realistic mode', () => {
      const radius = getRadius('orion', 'SPACECRAFT', 'realistic');
      expect(radius).toBe(SPACECRAFT_RADIUS_KM * KM_TO_UNIT);
    });
  });

  describe('getMoonOrbitScale', () => {
    it('should return 1 in realistic mode', () => {
      const scale = getMoonOrbitScale('399', 'ROCKY_PLANET', 384400, 'realistic');
      expect(scale).toBe(1);
    });

    it('should return > 1 when orbit is inside inflated didactic radius', () => {
      // Earth ('399') real radius is ~6371km.
      // In didactic mode, it is scaled by 2000.
      const earthDidacticRadius = getRadius('399', 'ROCKY_PLANET', 'didactic');
      
      // Let's use a small fake orbit (e.g., 10000 km) that would be inside the didactic planet
      const smallOrbitKm = 10000;
      const smallOrbitUnits = smallOrbitKm * KM_TO_UNIT;
      
      const scale = getMoonOrbitScale('399', 'ROCKY_PLANET', smallOrbitKm, 'didactic');
      
      // The scale should be exactly what's needed to push it out to the padding
      const expectedScale = (earthDidacticRadius * MOON_ORBIT_PADDING) / smallOrbitUnits;
      expect(scale).toBeCloseTo(expectedScale);
      expect(scale).toBeGreaterThan(1);
    });

    it('should return 1 when orbit is already outside the padded didactic radius', () => {
      const earthDidacticRadius = getRadius('399', 'ROCKY_PLANET', 'didactic');
      
      // Let's use a huge fake orbit that easily clears the padding
      const hugeOrbitKm = 1_000_000 * earthDidacticRadius * 10; 
      
      const scale = getMoonOrbitScale('399', 'ROCKY_PLANET', hugeOrbitKm, 'didactic');
      expect(scale).toBe(1);
    });
  });
});
