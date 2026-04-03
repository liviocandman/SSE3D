export enum MissionDataSource {
  AROW_LIVE = 'AROW_LIVE',
  ARCHIVE = 'ARCHIVE',
  SPICE_PREDICTED = 'SPICE_PREDICTED',
}

export enum MissionMode {
  LIVE = 'live',
  REPLAY = 'replay',
  PREDICTED = 'predicted',
}

export enum MissionPhase {
  LAUNCH = 'launch',
  EARTH_DEPARTURE = 'earth_departure',
  TRANSLUNAR_COAST = 'translunar_coast',
  LUNAR_FLYBY = 'lunar_flyby',
  RETURN_COAST = 'return_coast',
  REENTRY = 'reentry',
  SPLASHDOWN = 'splashdown',
}

export interface MissionPosition {
  x: number;
  y: number;
  z: number;
}

export interface MissionVelocity {
  x: number;
  y: number;
  z: number;
}

export interface MissionCoordinates {
  x: number;
  y: number;
  z: number;
}

export interface MissionDistances {
  earthKm: number;
  moonKm: number;
}

export interface MissionEvent {
  id: string;
  name: string;
  description: string;
  timestamp: string;
  phase: MissionPhase;
  isCompleted: boolean;
}

export enum MissionTrajectorySegment {
  PAST = 'past',
  CURRENT = 'current',
  PLANNED = 'planned',
}

export interface MissionTrajectoryPoint {
  timestamp: string;
  position: MissionPosition;
  velocity?: MissionVelocity;
  phase?: MissionPhase;
  segment: MissionTrajectorySegment;
}

export interface MissionState {
  missionId: string;
  vehicleId: string;
  mode: MissionMode;
  phase: MissionPhase;
  source: MissionDataSource;
  sourceTimestamp: string;
  stalenessSeconds: number;
  position: MissionPosition;
  velocity: MissionVelocity;
  distances: MissionDistances;
  missionElapsedTime: string;
  globalCoordinates?: MissionCoordinates;
  missionCoordinates?: MissionCoordinates;
  // Single render-space coordinate for Orion in the frontend.
  // It is Earth-relative and must be mounted under Earth's transform.
  sceneCoordinates?: MissionCoordinates;
}

export interface MissionTrajectory {
  missionId: string;
  past: MissionTrajectoryPoint[];
  planned: MissionTrajectoryPoint[];
}

export interface MissionEventsResponse {
  missionId: string;
  events: MissionEvent[];
  currentPhase: MissionPhase;
  nextEvent?: MissionEvent;
}

export interface MissionHealth {
  missionId: string;
  currentSource: MissionDataSource;
  lastUpdate: string;
  dataAgeSeconds: number;
  fallbackActive: boolean;
  coverageStart: string;
  coverageEnd: string;
  details?: Record<string, any>;
}
