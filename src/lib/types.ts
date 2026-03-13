/**
 * Ephemeris Types
 * Shared type definitions for ephemeris data
 */

export interface EphemerisPosition {
  x: number;
  y: number;
  z: number;
}

export interface EphemerisData {
  bodyId: string;
  name: string;
  position: EphemerisPosition;
  velocity?: EphemerisPosition; // km/s from NASA API
  timestamp: string;
}

export interface SelectedPlanet {
  bodyId: string;
  name: string;
  englishName: string;
  position: EphemerisPosition;
  velocity?: EphemerisPosition; // km/s from NASA API
  radius: number;
  distanceFromSun: number;
}

export type DataSource = 'NASA_LIVE' | 'CACHE_HIT' | 'FALLBACK_DATASET';

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
} as const;
