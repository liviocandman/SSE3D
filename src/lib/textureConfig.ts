/**
 * Texture Configuration
 * Maps bodyId to texture paths, visual properties, and orbital data
 */
import { BodyClass } from './scales';

// --- Types ---

export type TextureTier = 'low' | 'mid' | 'high';

export interface TexturePaths {
  low: string;
  mid: string;
  high: string;
}

export interface PlanetConfig {
  bodyId: string;
  name: string;
  englishName: string;
  type: 'STAR' | 'PLANET' | 'DWARF_PLANET';
  bodyClass: BodyClass;
  texturePaths: TexturePaths; // Tiered texture paths for adaptive loading
  fallbackColor: string;
  radius: number; // Scene units (will be computed dynamically if needed)
  rotationSpeed: number; // Radians per frame
  orbitalPeriod: number; // Earth days
  meanDistanceAU: number; // Astronomical Units from Sun
  orbitalInclination: number; // Degrees from ecliptic plane (i)
  eccentricity: number; // Orbital eccentricity (e) - 0=circle, closer to 1=more elliptical
  longAscNode: number; // Longitude of ascending node in degrees (Ω)
  longPerihelion: number; // Longitude of perihelion in degrees (ϖ)
  // Physical Properties
  surfaceGravity: number; // m/s² (Earth = 9.81)
  dayLength: number; // Hours for one rotation
  meanTemperature: number; // Celsius (average)
}

// Helper to generate tiered texture paths
const CDN_BASE = (
  process.env.NEXT_PUBLIC_TEXTURE_CDN_URL ?? "/textures"
).replace(/\/$/, "");

function getTexturePaths(name: string): TexturePaths {
  return {
    low: `${CDN_BASE}/${name}_low.webp`,
    mid: `${CDN_BASE}/${name}_mid.webp`,
    high: `${CDN_BASE}/${name}_high.webp`,
  };
}

// --- Texture Map ---
// Initial radius values are placeholders, they should be derived from src/lib/scales.ts in the components

export const PLANET_CONFIG: Record<string, PlanetConfig> = {
  '10': {
    bodyId: '10',
    name: 'Sol',
    englishName: 'Sun',
    type: 'STAR',
    bodyClass: 'STAR',
    texturePaths: getTexturePaths('sun'),
    fallbackColor: '#FDB813',
    radius: 34.8,
    rotationSpeed: 0.001,
    orbitalPeriod: 0,
    meanDistanceAU: 0,
    orbitalInclination: 0,
    eccentricity: 0,
    longAscNode: 0,
    longPerihelion: 0,
    surfaceGravity: 274,
    dayLength: 609.12,
    meanTemperature: 5500,
  },
  '199': {
    bodyId: '199',
    name: 'Mercúrio',
    englishName: 'Mercury',
    type: 'PLANET',
    bodyClass: 'ROCKY_PLANET',
    texturePaths: getTexturePaths('mercury'),
    fallbackColor: '#8C7853',
    radius: 4.8,
    rotationSpeed: 0.001,
    orbitalPeriod: 88,
    meanDistanceAU: 0.387,
    orbitalInclination: 7.0,
    eccentricity: 0.2056,
    longAscNode: 48.33,
    longPerihelion: 77.45,
    surfaceGravity: 3.7,
    dayLength: 4222.6,
    meanTemperature: 167,
  },
  '299': {
    bodyId: '299',
    name: 'Vênus',
    englishName: 'Venus',
    type: 'PLANET',
    bodyClass: 'ROCKY_PLANET',
    texturePaths: getTexturePaths('venus'),
    fallbackColor: '#FFC649',
    radius: 12.1,
    rotationSpeed: 0.0005,
    orbitalPeriod: 225,
    meanDistanceAU: 0.723,
    orbitalInclination: 3.4,
    eccentricity: 0.0068,
    longAscNode: 76.68,
    longPerihelion: 131.53,
    surfaceGravity: 8.87,
    dayLength: 2802,
    meanTemperature: 464,
  },
  '399': {
    bodyId: '399',
    name: 'Terra',
    englishName: 'Earth',
    type: 'PLANET',
    bodyClass: 'ROCKY_PLANET',
    texturePaths: getTexturePaths('earth'),
    fallbackColor: '#6B93D6',
    radius: 12.7,
    rotationSpeed: 0.002,
    orbitalPeriod: 365,
    meanDistanceAU: 1.0,
    orbitalInclination: 0.0,
    eccentricity: 0.0167,
    longAscNode: 0.0,
    longPerihelion: 102.94,
    surfaceGravity: 9.81,
    dayLength: 24,
    meanTemperature: 15,
  },
  '499': {
    bodyId: '499',
    name: 'Marte',
    englishName: 'Mars',
    type: 'PLANET',
    bodyClass: 'ROCKY_PLANET',
    texturePaths: getTexturePaths('mars'),
    fallbackColor: '#C1440E',
    radius: 6.7,
    rotationSpeed: 0.0019,
    orbitalPeriod: 687,
    meanDistanceAU: 1.524,
    orbitalInclination: 1.85,
    eccentricity: 0.0934,
    longAscNode: 49.58,
    longPerihelion: 336.04,
    surfaceGravity: 3.71,
    dayLength: 24.6,
    meanTemperature: -65,
  },
  '599': {
    bodyId: '599',
    name: 'Júpiter',
    englishName: 'Jupiter',
    type: 'PLANET',
    bodyClass: 'GAS_GIANT',
    texturePaths: getTexturePaths('jupiter'),
    fallbackColor: '#D8CA9D',
    radius: 71.4,
    rotationSpeed: 0.004,
    orbitalPeriod: 4333,
    meanDistanceAU: 5.203,
    orbitalInclination: 1.3,
    eccentricity: 0.0489,
    longAscNode: 100.46,
    longPerihelion: 14.75,
    surfaceGravity: 24.79,
    dayLength: 9.9,
    meanTemperature: -110,
  },
  '699': {
    bodyId: '699',
    name: 'Saturno',
    englishName: 'Saturn',
    type: 'PLANET',
    bodyClass: 'GAS_GIANT',
    texturePaths: getTexturePaths('saturn'),
    fallbackColor: '#EAD6B8',
    radius: 60.2,
    rotationSpeed: 0.0038,
    orbitalPeriod: 10759,
    meanDistanceAU: 9.537,
    orbitalInclination: 2.49,
    eccentricity: 0.0565,
    longAscNode: 113.66,
    longPerihelion: 92.43,
    surfaceGravity: 10.44,
    dayLength: 10.7,
    meanTemperature: -140,
  },
  '799': {
    bodyId: '799',
    name: 'Urano',
    englishName: 'Uranus',
    type: 'PLANET',
    bodyClass: 'GAS_GIANT',
    texturePaths: getTexturePaths('uranus'),
    fallbackColor: '#D1E7E7',
    radius: 25.5,
    rotationSpeed: 0.003,
    orbitalPeriod: 30687,
    meanDistanceAU: 19.191,
    orbitalInclination: 0.77,
    eccentricity: 0.0457,
    longAscNode: 74.01,
    longPerihelion: 170.96,
    surfaceGravity: 8.87,
    dayLength: 17.2,
    meanTemperature: -195,
  },
  '899': {
    bodyId: '899',
    name: 'Netuno',
    englishName: 'Neptune',
    type: 'PLANET',
    bodyClass: 'GAS_GIANT',
    texturePaths: getTexturePaths('neptune'),
    fallbackColor: '#5B5DDF',
    radius: 24.7,
    rotationSpeed: 0.0032,
    orbitalPeriod: 60190,
    meanDistanceAU: 30.069,
    orbitalInclination: 1.77,
    eccentricity: 0.0113,
    longAscNode: 131.78,
    longPerihelion: 44.97,
    surfaceGravity: 11.15,
    dayLength: 16.1,
    meanTemperature: -200,
  },
};

// --- Helper Functions ---

/**
 * Get texture path for a body based on quality tier
 */
export function getTexturePath(bodyId: string, tier: TextureTier = 'mid'): string {
  const config = PLANET_CONFIG[bodyId];
  if (!config) {
    console.warn(`[textureConfig] No config found for bodyId: ${bodyId}`);
    return '';
  }
  return config.texturePaths[tier];
}

/**
 * Get planet configuration by bodyId
 */
export function getPlanetConfig(bodyId: string): PlanetConfig | undefined {
  return PLANET_CONFIG[bodyId];
}

/**
 * Get all planet bodyIds (excluding Sun)
 */
export function getPlanetBodyIds(): string[] {
  return Object.keys(PLANET_CONFIG).filter(id => PLANET_CONFIG[id].type === 'PLANET');
}

/**
 * Get all body IDs including Sun
 */
export function getAllBodyIds(): string[] {
  return Object.keys(PLANET_CONFIG);
}

/**
 * Calculate distance between two bodies in millions of km
 */
export function calculateDistance(
  pos1: { x: number; y: number; z: number },
  pos2: { x: number; y: number; z: number }
): number {
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  const dz = pos1.z - pos2.z;

  // Real distances in KM are handled directly now since we work with million km units
  const sceneDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return sceneDistance; // In million km
}
