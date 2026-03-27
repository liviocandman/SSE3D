/**
 * Scale System Utilities
 * Core Principle: 1 Three.js Unit = 1,000,000 km (1 Million km)
 */

// Conversion factor: km to Three.js units
export const KM_TO_UNIT = 1 / 1_000_000;

// Conversion factor: AU to Three.js units (1 AU = 149.6 million km)
export const AU_TO_UNIT = 149.59787;


// Didactic visual multipliers
// These inflate objects so they are visible while maintaining relative position accuracy
export const DIDACTIC_SCALE = {
  SUN: 50,
  GAS_GIANT: 400,
  ROCKY_PLANET: 2000,
  MOON: 1500,
};

// Planet type classification
export type BodyClass = 'STAR' | 'GAS_GIANT' | 'ROCKY_PLANET' | 'DWARF_PLANET' | 'MOON';

// Real radii in km (source: NASA)
export const REAL_RADII_KM: Record<string, number> = {
  '10': 696000,    // Sun
  '199': 2440,     // Mercury
  '299': 6052,     // Venus
  '399': 6371,     // Earth
  '499': 3390,     // Mars
  '599': 71492,    // Jupiter (equatorial)
  '699': 60268,    // Saturn (equatorial)
  '799': 25559,    // Uranus (equatorial)
  '899': 24764,    // Neptune (equatorial)
  '999': 1188,     // Pluto
  '301': 1737,     // Moon
  '401': 11,       // Phobos
  '402': 6,        // Deimos
  '501': 1822,     // Io
  '502': 1561,     // Europa
  '503': 2634,     // Ganymede
  '504': 2410,     // Callisto
  '601': 198,      // Mimas
  '602': 252,      // Enceladus
  '603': 531,      // Tethys
  '604': 561,      // Dione
  '605': 763,      // Rhea
  '606': 2575,     // Titan
  '608': 734,      // Iapetus
  '701': 579,      // Ariel
  '702': 585,      // Umbriel
  '703': 788,      // Titania
  '704': 761,      // Oberon
  '705': 236,      // Miranda
  '801': 1353,     // Triton
  '901': 606,      // Charon
};

/**
 * Additional clearance multiplier for moon orbits around didactically-inflated planets.
 */
export const MOON_ORBIT_PADDING = 1.5;

/**
 * Converts real radius in km to didactic rendering units
 */
export function getDidacticRadius(bodyId: string, bodyClass: BodyClass): number {
  const realRadiusKm = REAL_RADII_KM[bodyId] || 1000;
  const baseRadius = realRadiusKm * KM_TO_UNIT;

  switch (bodyClass) {
    case 'STAR':
      return baseRadius * DIDACTIC_SCALE.SUN;
    case 'GAS_GIANT':
      return baseRadius * DIDACTIC_SCALE.GAS_GIANT;
    case 'ROCKY_PLANET':
    case 'DWARF_PLANET':
      return baseRadius * DIDACTIC_SCALE.ROCKY_PLANET;
    case 'MOON':
      return baseRadius * DIDACTIC_SCALE.MOON;
    default:
      return baseRadius * DIDACTIC_SCALE.ROCKY_PLANET;
  }
}

/**
 * Converts position from real km to scene units
 */
export function scalePositionFromKm(x: number, y: number, z: number): [number, number, number] {
  return [
    x * KM_TO_UNIT,
    y * KM_TO_UNIT,
    z * KM_TO_UNIT
  ];
}

/**
 * Converts scene units back to million km for display
 */
export function unitToMillionKm(units: number): number {
  return units; // Since 1 unit = 1 million km
}

// --- View Mode System ---

/**
 * View mode determines how planets are scaled:
 * - 'didactic': Planets are inflated (50-3000x) for visibility
 * - 'realistic': Planets are true-to-scale (1:1 with distance)
 */
export type ViewMode = 'didactic' | 'realistic';

/**
 * Orbit visual settings per view mode
 */
export const ORBIT_CONFIG = {
  didactic: {
    opacity: 0.15,
    lineWidth: 2,
  },
  realistic: {
    opacity: 0.03,  // Very subtle
    lineWidth: 1.5, // Thin line
  },
};

/**
 * Gets radius based on view mode
 * @param bodyId - NASA body ID
 * @param bodyClass - Type of celestial body
 * @param mode - 'didactic' (inflated) or 'realistic' (true scale)
 * @returns Radius in scene units
 */
export function getRadius(
  bodyId: string,
  bodyClass: BodyClass,
  mode: ViewMode = 'didactic'
): number {
  const realRadiusKm = REAL_RADII_KM[bodyId] || 1000;
  const realisticRadius = realRadiusKm * KM_TO_UNIT;

  if (mode === 'realistic') {
    return realisticRadius; // True scale (e.g., Earth = 0.00637 units, Sun = 0.696 units)
  }

  // Didactic mode - apply multipliers
  switch (bodyClass) {
    case 'STAR':
      return realisticRadius * DIDACTIC_SCALE.SUN;
    case 'GAS_GIANT':
      return realisticRadius * DIDACTIC_SCALE.GAS_GIANT;
    case 'ROCKY_PLANET':
    case 'DWARF_PLANET':
      return realisticRadius * DIDACTIC_SCALE.ROCKY_PLANET;
    case 'MOON':
      return realisticRadius * DIDACTIC_SCALE.MOON;
    default:
      return realisticRadius * DIDACTIC_SCALE.ROCKY_PLANET;
  }
}

/**
 * Scales moon orbits to keep them outside the didactically-inflated parent planet.
 */
export function getMoonOrbitScale(
  parentId: string,
  parentClass: BodyClass,
  realOrbitRadiusKm: number,
  mode: ViewMode = 'didactic'
): number {
  if (mode === 'realistic') return 1;

  const parentDidacticRadius = getRadius(parentId, parentClass, 'didactic');
  const realOrbitInUnits = realOrbitRadiusKm * KM_TO_UNIT;
  if (realOrbitInUnits <= 0) return 1;

  const minOrbitUnits = parentDidacticRadius * MOON_ORBIT_PADDING;
  if (realOrbitInUnits >= minOrbitUnits) return 1;

  return minOrbitUnits / realOrbitInUnits;
}
