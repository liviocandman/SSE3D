/**
 * Ephemeris Types
 * Shared type definitions for ephemeris data
 */

export interface EphemerisPosition {
  x: number;
  y: number;
  z: number;
}

export interface EphemerisTrajectory {
  position: EphemerisPosition;
  velocity?: EphemerisPosition;
  timestamp: string;
}

export interface EphemerisData {
  bodyId: string;
  name: string;
  position: EphemerisPosition;
  velocity?: EphemerisPosition; // km/s from NASA API
  timestamp: string;
  parentId?: string;
  trajectory?: EphemerisTrajectory[];
}

export interface SelectedPlanet {
  bodyId: string;
  name: string;
  englishName: string;
  position: EphemerisPosition;
  velocity?: EphemerisPosition; // km/s from NASA API
  radius: number;
  distanceFromSun: number;
  // Moon-specific fields (only set when body is a moon)
  parentId?: string;           // NASA ID of parent planet
  parentName?: string;         // Human-readable parent planet name (e.g. 'Jupiter')
  distanceToParentKm?: number; // Live distance to parent computed from API position vector
  trajectory?: EphemerisTrajectory[];
}

export type DataSource =
  | 'NASA_LIVE'
  | 'CACHE_HIT'
  | 'FALLBACK_DATASET'
  | 'SPICE_KERNELS'
  | 'SPICE_AND_FALLBACK';

export interface EphemerisResponse {
  data: EphemerisData[];
  meta: {
    source: DataSource;
    timestamp: string;
    requestedDate: string;
    cacheHits?: number;
    cacheMisses?: number;
  };
}

export const MISSION_CONFIG = {
  // Story 8.3: Feature flag for spacecraft attitude support.
  // Disabled until CK kernels are validated.
  ENABLE_ATTITUDE: false,
};

// Body ID constants - same as nasaClient
export const BODY_IDS = {
  SUN: '10',
  MERCURY: '199',
  VENUS: '299',
  EARTH: '399',
  MARS: '499',
  JUPITER: '599',
  SATURN: '699',
  URANUS: '799',
  NEPTUNE: '899',
  PLUTO: '999',
  MOON: '301',
  PHOBOS: '401',
  DEIMOS: '402',
  IO: '501',
  EUROPA: '502',
  GANYMEDE: '503',
  CALLISTO: '504',
  MIMAS: '601',
  ENCELADUS: '602',
  TETHYS: '603',
  DIONE: '604',
  RHEA: '605',
  TITAN: '606',
  IAPETUS: '608',
  ARIEL: '701',
  UMBRIEL: '702',
  TITANIA: '703',
  OBERON: '704',
  MIRANDA: '705',
  TRITON: '801',
  CHARON: '901',
} as const;
