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
  type: 'STAR' | 'PLANET' | 'DWARF_PLANET' | 'MOON';
  bodyClass: BodyClass;
  texturePaths: TexturePaths; // Tiered texture paths for adaptive loading
  fallbackColor: string;
  radius: number; // Scene units (will be computed dynamically if needed)
  rotationSpeed: number; // Radians per frame
  axialTilt: number; // Degrees from orbital perpendicular
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
  // Moon-specific metadata
  surfaceType?: string;  // e.g. 'Water Ice', 'Silicate Rock'
  discoverer?: string;   // e.g. 'Galileo Galilei (1610)'
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
    axialTilt: 7.25,
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
    axialTilt: 0.03,
    orbitalPeriod: 88,
    meanDistanceAU: 0.387,
    orbitalInclination: 7.0,
    eccentricity: 0.2056,
    longAscNode: 48.33,
    longPerihelion: 77.45,
    surfaceGravity: 3.7,
    dayLength: 1407.6,
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
    axialTilt: 177.36,
    orbitalPeriod: 225,
    meanDistanceAU: 0.723,
    orbitalInclination: 3.4,
    eccentricity: 0.0068,
    longAscNode: 76.68,
    longPerihelion: 131.53,
    surfaceGravity: 8.87,
    dayLength: -5832.5,
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
    axialTilt: 23.44,
    orbitalPeriod: 365,
    meanDistanceAU: 1.0,
    orbitalInclination: 0.0,
    eccentricity: 0.0167,
    longAscNode: 0.0,
    longPerihelion: 102.94,
    surfaceGravity: 9.81,
    dayLength: 23.93,
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
    axialTilt: 25.19,
    orbitalPeriod: 687,
    meanDistanceAU: 1.524,
    orbitalInclination: 1.85,
    eccentricity: 0.0934,
    longAscNode: 49.58,
    longPerihelion: 336.04,
    surfaceGravity: 3.71,
    dayLength: 24.62,
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
    axialTilt: 3.13,
    orbitalPeriod: 4333,
    meanDistanceAU: 5.203,
    orbitalInclination: 1.3,
    eccentricity: 0.0489,
    longAscNode: 100.46,
    longPerihelion: 14.75,
    surfaceGravity: 24.79,
    dayLength: 9.92,
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
    axialTilt: 26.73,
    orbitalPeriod: 10759,
    meanDistanceAU: 9.537,
    orbitalInclination: 2.49,
    eccentricity: 0.0565,
    longAscNode: 113.66,
    longPerihelion: 92.43,
    surfaceGravity: 10.44,
    dayLength: 10.65,
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
    axialTilt: 97.77,
    orbitalPeriod: 30687,
    meanDistanceAU: 19.191,
    orbitalInclination: 0.77,
    eccentricity: 0.0457,
    longAscNode: 74.01,
    longPerihelion: 170.96,
    surfaceGravity: 8.87,
    dayLength: -17.24,
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
    axialTilt: 28.32,
    orbitalPeriod: 60190,
    meanDistanceAU: 30.069,
    orbitalInclination: 1.77,
    eccentricity: 0.0113,
    longAscNode: 131.78,
    longPerihelion: 44.97,
    surfaceGravity: 11.15,
    dayLength: 16.11,
    meanTemperature: -200,
  },
  '301': {
    bodyId: '301',
    name: 'Lua',
    englishName: 'Moon',
    type: 'MOON',
    bodyClass: 'MOON',
    texturePaths: getTexturePaths('moon'),
    fallbackColor: '#c0c0c0',
    radius: 0,
    rotationSpeed: 0.0005,
    axialTilt: 0,
    orbitalPeriod: 27.3,
    meanDistanceAU: 0.00257,
    orbitalInclination: 5.14,
    eccentricity: 0.0549,
    longAscNode: 125.08,
    longPerihelion: 83.23,
    surfaceGravity: 1.62,
    dayLength: 708.7,
    meanTemperature: -20,
    surfaceType: 'Regolith & Silicate Rock',
    discoverer: 'Known since antiquity',
  },
  '501': {
    bodyId: '501',
    name: 'Io',
    englishName: 'Io',
    type: 'MOON',
    bodyClass: 'MOON',
    texturePaths: getTexturePaths('io'),
    fallbackColor: '#ffff66',
    radius: 0,
    rotationSpeed: 0.001,
    axialTilt: 0,
    orbitalPeriod: 1.77,
    meanDistanceAU: 0.00282,
    orbitalInclination: 0.04,
    eccentricity: 0.0041,
    longAscNode: 0,
    longPerihelion: 0,
    surfaceGravity: 1.8,
    dayLength: 42.5,
    meanTemperature: -143,
    surfaceType: 'Sulfur & Volcanic Rock',
    discoverer: 'Galileo Galilei (1610)',
  },
  '502': {
    bodyId: '502',
    name: 'Europa',
    englishName: 'Europa',
    type: 'MOON',
    bodyClass: 'MOON',
    texturePaths: getTexturePaths('europa'),
    fallbackColor: '#d8d8d8',
    radius: 0,
    rotationSpeed: 0.0008,
    axialTilt: 0,
    orbitalPeriod: 3.55,
    meanDistanceAU: 0.00449,
    orbitalInclination: 0.47,
    eccentricity: 0.009,
    longAscNode: 0,
    longPerihelion: 0,
    surfaceGravity: 1.31,
    dayLength: 85.2,
    meanTemperature: -160,
    surfaceType: 'Water Ice (subsurface ocean)',
    discoverer: 'Galileo Galilei (1610)',
  },
  '503': {
    bodyId: '503',
    name: 'Ganymede',
    englishName: 'Ganymede',
    type: 'MOON',
    bodyClass: 'MOON',
    texturePaths: getTexturePaths('ganymede'),
    fallbackColor: '#a0a0a0',
    radius: 0,
    rotationSpeed: 0.0007,
    axialTilt: 0,
    orbitalPeriod: 7.15,
    meanDistanceAU: 0.00715,
    orbitalInclination: 0.2,
    eccentricity: 0.0013,
    longAscNode: 0,
    longPerihelion: 0,
    surfaceGravity: 1.43,
    dayLength: 171.7,
    meanTemperature: -163,
    surfaceType: 'Ice & Silicate Rock',
    discoverer: 'Galileo Galilei (1610)',
  },
  '504': {
    bodyId: '504',
    name: 'Callisto',
    englishName: 'Callisto',
    type: 'MOON',
    bodyClass: 'MOON',
    texturePaths: getTexturePaths('callisto'),
    fallbackColor: '#8a8a8a',
    radius: 0,
    rotationSpeed: 0.0006,
    axialTilt: 0,
    orbitalPeriod: 16.69,
    meanDistanceAU: 0.01258,
    orbitalInclination: 0.28,
    eccentricity: 0.0074,
    longAscNode: 0,
    longPerihelion: 0,
    surfaceGravity: 1.24,
    dayLength: 400.6,
    meanTemperature: -139,
    surfaceType: 'Ancient Ice & Cratered Rock',
    discoverer: 'Galileo Galilei (1610)',
  },
  '999': {
    bodyId: '999', name: 'Plutão', englishName: 'Pluto',
    type: 'DWARF_PLANET', bodyClass: 'DWARF_PLANET',
    texturePaths: getTexturePaths('generic_moon'),
    fallbackColor: '#dbd7d2', radius: 0, rotationSpeed: 0.001, axialTilt: 122.53,
    orbitalPeriod: 90560, meanDistanceAU: 39.48, orbitalInclination: 17.16, eccentricity: 0.2488,
    longAscNode: 110.30, longPerihelion: 113.83, surfaceGravity: 0.62, dayLength: -153.3, meanTemperature: -229,
  },
  '401': {
    bodyId: '401', name: 'Fobos', englishName: 'Phobos',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('generic_moon'), fallbackColor: '#8a8a8a', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 0.32, meanDistanceAU: 0.00006, orbitalInclination: 1.09, eccentricity: 0.0151,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.0057, dayLength: 7.6, meanTemperature: -40,
    surfaceType: 'Carbonaceous Regolith',
    discoverer: 'Asaph Hall (1877)',
  },
  '402': {
    bodyId: '402', name: 'Deimos', englishName: 'Deimos',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('generic_moon'), fallbackColor: '#c0c0c0', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 1.26, meanDistanceAU: 0.00016, orbitalInclination: 0.93, eccentricity: 0.0002,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.003, dayLength: 30.3, meanTemperature: -40,
    surfaceType: 'Carbonaceous Regolith',
    discoverer: 'Asaph Hall (1877)',
  },
  '601': {
    bodyId: '601', name: 'Mimas', englishName: 'Mimas',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('generic_moon'), fallbackColor: '#d8d8d8', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 0.94, meanDistanceAU: 0.0012, orbitalInclination: 1.57, eccentricity: 0.0202,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.064, dayLength: 22.6, meanTemperature: -209,
    surfaceType: 'Water Ice',
    discoverer: 'William Herschel (1789)',
  },
  '602': {
    bodyId: '602', name: 'Encélado', englishName: 'Enceladus',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('enceladus'), fallbackColor: '#e0e0e0', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 1.37, meanDistanceAU: 0.0016, orbitalInclination: 0.01, eccentricity: 0.0047,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.113, dayLength: 32.9, meanTemperature: -198,
    surfaceType: 'Water Ice (active geysers)',
    discoverer: 'William Herschel (1789)',
  },
  '603': {
    bodyId: '603', name: 'Tétis', englishName: 'Tethys',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('generic_moon'), fallbackColor: '#c8c8c8', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 1.89, meanDistanceAU: 0.002, orbitalInclination: 1.12, eccentricity: 0.0001,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.145, dayLength: 45.3, meanTemperature: -187,
    surfaceType: 'Water Ice & Rock',
    discoverer: 'Giovanni Cassini (1684)',
  },
  '604': {
    bodyId: '604', name: 'Dione', englishName: 'Dione',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('generic_moon'), fallbackColor: '#b0b0b0', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 2.74, meanDistanceAU: 0.0025, orbitalInclination: 0.02, eccentricity: 0.0022,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.232, dayLength: 65.7, meanTemperature: -186,
    surfaceType: 'Water Ice & Silicate Rock',
    discoverer: 'Giovanni Cassini (1684)',
  },
  '605': {
    bodyId: '605', name: 'Reia', englishName: 'Rhea',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('generic_moon'), fallbackColor: '#989898', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 4.52, meanDistanceAU: 0.0035, orbitalInclination: 0.33, eccentricity: 0.0012,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.264, dayLength: 108.4, meanTemperature: -174,
    surfaceType: 'Water Ice & Rock',
    discoverer: 'Giovanni Cassini (1672)',
  },
  '606': {
    bodyId: '606', name: 'Titã', englishName: 'Titan',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('titan'), fallbackColor: '#d6b85a', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 15.95, meanDistanceAU: 0.0082, orbitalInclination: 0.35, eccentricity: 0.0288,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 1.352, dayLength: 382.7, meanTemperature: -179,
    surfaceType: 'Nitrogen Ice & Hydrocarbon Lakes',
    discoverer: 'Christiaan Huygens (1655)',
  },
  '608': {
    bodyId: '608', name: 'Jápeto', englishName: 'Iapetus',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('generic_moon'), fallbackColor: '#8a8882', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 79.33, meanDistanceAU: 0.0238, orbitalInclination: 15.47, eccentricity: 0.0286,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.223, dayLength: 1904, meanTemperature: -143,
    surfaceType: 'Dark Carbon & Bright Ice',
    discoverer: 'Giovanni Cassini (1671)',
  },
  '701': {
    bodyId: '701', name: 'Ariel', englishName: 'Ariel',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('generic_moon'), fallbackColor: '#c4c6cc', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 2.52, meanDistanceAU: 0.0013, orbitalInclination: 0.26, eccentricity: 0.0012,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.269, dayLength: 60.5, meanTemperature: -213,
    surfaceType: 'Water Ice & Carbon Dioxide',
    discoverer: 'William Lassell (1851)',
  },
  '702': {
    bodyId: '702', name: 'Umbriel', englishName: 'Umbriel',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('generic_moon'), fallbackColor: '#6c6f75', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 4.14, meanDistanceAU: 0.0018, orbitalInclination: 0.36, eccentricity: 0.0039,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.2, dayLength: 99.5, meanTemperature: -213,
    surfaceType: 'Dark Carbon-rich Ice',
    discoverer: 'William Lassell (1851)',
  },
  '703': {
    bodyId: '703', name: 'Titânia', englishName: 'Titania',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('generic_moon'), fallbackColor: '#b4b7bd', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 8.71, meanDistanceAU: 0.0029, orbitalInclination: 0.34, eccentricity: 0.0011,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.379, dayLength: 209, meanTemperature: -213,
    surfaceType: 'Water Ice & Rock',
    discoverer: 'William Herschel (1787)',
  },
  '704': {
    bodyId: '704', name: 'Oberon', englishName: 'Oberon',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('generic_moon'), fallbackColor: '#9c9ea4', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 13.46, meanDistanceAU: 0.0039, orbitalInclination: 0.1, eccentricity: 0.0014,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.346, dayLength: 323, meanTemperature: -213,
    surfaceType: 'Ice & Dark Carbon Rock',
    discoverer: 'William Herschel (1787)',
  },
  '705': {
    bodyId: '705', name: 'Miranda', englishName: 'Miranda',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('generic_moon'), fallbackColor: '#cfd2d8', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 1.41, meanDistanceAU: 0.0008, orbitalInclination: 4.22, eccentricity: 0.0013,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.079, dayLength: 33.9, meanTemperature: -213,
    surfaceType: 'Ice & Chaotic Terrain',
    discoverer: 'Gerard Kuiper (1948)',
  },
  '801': {
    bodyId: '801', name: 'Tritão', englishName: 'Triton',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('triton'), fallbackColor: '#d1e6e3', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 5.88, meanDistanceAU: 0.0024, orbitalInclination: 156.88, eccentricity: 0.00002,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.779, dayLength: 141, meanTemperature: -235,
    surfaceType: 'Nitrogen Ice & Geysers',
    discoverer: 'William Lassell (1846)',
  },
  '901': {
    bodyId: '901', name: 'Caronte', englishName: 'Charon',
    type: 'MOON', bodyClass: 'MOON',
    texturePaths: getTexturePaths('generic_moon'), fallbackColor: '#b8a696', radius: 0, rotationSpeed: 0.001, axialTilt: 0,
    orbitalPeriod: 6.39, meanDistanceAU: 0.00013, orbitalInclination: 0.001, eccentricity: 0.0002,
    longAscNode: 0, longPerihelion: 0, surfaceGravity: 0.288, dayLength: 153.3, meanTemperature: -220,
    surfaceType: 'Water Ice & Ammonia',
    discoverer: 'James Christy (1978)',
  },
};

export const PLANET_MOONS: Record<string, string[]> = {
  '399': ['301'],
  '499': ['401', '402'],
  '599': ['501', '502', '503', '504'],
  '699': ['601', '602', '603', '604', '605', '606', '608'],
  '799': ['701', '702', '703', '704', '705'],
  '899': ['801'],
  '999': ['901'],
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
