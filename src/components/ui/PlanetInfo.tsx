'use client';

import { PLANET_CONFIG } from '@/lib/textureConfig';
import { REAL_RADII_KM } from '@/lib/scales';

// --- Types ---

interface PlanetData {
  bodyId: string;
  englishName: string;
  position: { x: number; y: number; z: number };
  velocity?: { x: number; y: number; z: number }; // km/s from NASA API
  distanceFromSun: number; // million km
}

interface PlanetInfoProps {
  planet: PlanetData | null;
  earthPosition?: { x: number; y: number; z: number };
  onAskAstronomer?: () => void;
}

// --- Helper Functions ---

function calculateMillionKmDistance(
  pos1: { x: number; y: number; z: number },
  pos2: { x: number; y: number; z: number }
): number {
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function formatNumber(num: number, decimals = 1): string {
  if (Math.abs(num) >= 1000) {
    return num.toLocaleString('en-US', { maximumFractionDigits: decimals });
  }
  return num.toFixed(decimals);
}

function formatDayLength(hours: number): string {
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = Math.round(hours % 24);
    if (remainingHours > 0) {
      return `${days}d ${remainingHours}h`;
    }
    return `${days} days`;
  }
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function calculateVelocityMagnitude(velocity: { x: number; y: number; z: number }): number {
  return Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
}

// --- Planet Type Icons ---

const PLANET_ICONS: Record<string, string> = {
  STAR: '☀️',
  PLANET: '🪐',
  DWARF_PLANET: '🌑',
};

// --- Component ---

export function PlanetInfo({ planet, earthPosition, onAskAstronomer }: PlanetInfoProps) {
  if (!planet) {
    return (
      <div className="text-center py-8 px-4 text-white/50 animate-in fade-in duration-700">
        <div className="text-5xl mb-4 opacity-50">🌍</div>
        <p>Select a planet to view details</p>
      </div>
    );
  }

  const config = PLANET_CONFIG[planet.bodyId];
  const planetType = config?.type || 'PLANET';
  const orbitalPeriod = config?.orbitalPeriod || 0;
  const realRadiusKm = REAL_RADII_KM[planet.bodyId] || 0;
  const diameterKm = realRadiusKm * 2;

  // Calculate orbital velocity from NASA API velocity vector
  const orbitalVelocity = planet.velocity
    ? calculateVelocityMagnitude(planet.velocity)
    : null;

  // Fallback: calculate using v = 2πr/T if no API velocity
  const fallbackVelocity = (() => {
    if (orbitalVelocity !== null) return null;
    const orbitalRadius = planet.distanceFromSun * 1e6;
    const orbitalPeriodSeconds = orbitalPeriod * 24 * 60 * 60;
    return orbitalPeriodSeconds > 0
      ? (2 * Math.PI * orbitalRadius) / orbitalPeriodSeconds
      : null;
  })();

  const displayVelocity = orbitalVelocity ?? fallbackVelocity;

  // Calculate distance from Earth
  const distanceFromEarth = earthPosition
    ? calculateMillionKmDistance(planet.position, earthPosition)
    : null;

  const planetIcon = PLANET_ICONS[planetType] || '🪐';
  const fallbackColor = config?.fallbackColor || '#666';

  // Gravity relative to Earth
  const gravityG = config ? (config.surfaceGravity / 9.81).toFixed(2) : null;

  return (
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
          style={{
            background: `radial-gradient(circle at 30% 30%, ${fallbackColor}aa, ${fallbackColor})`,
            boxShadow: `0 0 20px ${fallbackColor}40`,
          }}
        >
          {planetIcon}
        </div>
        <div className="flex flex-col">
          <h2 className="text-2xl font-semibold text-white m-0">
            {planet.englishName}
          </h2>
          <span className="text-sm text-white/50 uppercase tracking-widest">
            {planetType.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* AI Assistant Hero Card */}
      {onAskAstronomer && (
        <button
          onClick={onAskAstronomer}
          className="relative overflow-hidden w-full group rounded-2xl border border-blue-500/30 bg-gradient-to-r from-blue-900/20 to-indigo-900/20 p-4 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:border-blue-400/50"
        >
          {/* Animated background glow */}
          <div className="absolute inset-0 bg-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          <div className="relative flex items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/20 border border-blue-500/30 text-lg shadow-[0_0_15px_rgba(59,130,246,0.4)] group-hover:bg-blue-500/30 transition-colors">
              ✨
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-blue-100 tracking-wide uppercase">
                Virtual Astronomer
              </span>
              <span className="text-[11px] text-blue-200/60 mt-0.5">
                Get your questions answered with our Astronomy EncyclopedIA.
              </span>
            </div>
          </div>
        </button>
      )}

      {/* Stats Grid - Original 2x2 layout */}
      <div className="grid grid-cols-2 gap-3">
        {/* Distance from Sun */}
        <StatCard
          label="Distance from Sun"
          value={formatNumber(planet.distanceFromSun)}
          unit="M km"
        />

        {/* Distance from Earth */}
        <StatCard
          label="Distance from Earth"
          value={distanceFromEarth !== null ? formatNumber(distanceFromEarth) : '—'}
          unit="M km"
        />

        {/* Orbital Velocity */}
        <StatCard
          label="Orbital Velocity"
          value={displayVelocity !== null ? formatNumber(displayVelocity) : '—'}
          unit="km/s"
        />

        {/* Orbital Period */}
        <StatCard
          label="Orbital Period"
          value={orbitalPeriod > 0 ? formatNumber(orbitalPeriod, 0) : '—'}
          unit="days"
        />
      </div>

      {/* Physical Properties Section */}
      {config && (
        <>
          <h3 className="text-xs text-white/40 uppercase tracking-widest font-semibold mt-2">
            🌍 Physical Properties
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {/* Surface Gravity */}
            <StatCard
              label="Surface Gravity"
              value={`${config.surfaceGravity.toFixed(2)}`}
              unit={`m/s² (${gravityG}g)`}
            />

            {/* Day Length */}
            <StatCard
              label="Day Length"
              value={formatDayLength(config.dayLength)}
              unit=""
            />

            {/* Mean Temperature */}
            <StatCard
              label="Temperature"
              value={`${config.meanTemperature > 0 ? '+' : ''}${config.meanTemperature}`}
              unit="°C"
            />

            {/* Diameter */}
            <StatCard
              label="Diameter"
              value={formatNumber(diameterKm, 0)}
              unit="km"
            />
          </div>
        </>
      )}

      {/* Orbital Data Section */}
      {config && (
        <>
          <h3 className="text-xs text-white/40 uppercase tracking-widest font-semibold mt-2">
            🛸 Orbital Data
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {/* Semi-Major Axis */}
            <StatCard
              label="Semi-Major Axis"
              value={formatNumber(config.meanDistanceAU, 3)}
              unit="AU"
            />

            {/* Eccentricity */}
            <StatCard
              label="Eccentricity"
              value={config.eccentricity.toFixed(4)}
              unit=""
            />

            {/* Inclination */}
            <StatCard
              label="Inclination"
              value={`${config.orbitalInclination.toFixed(2)}°`}
              unit=""
            />

            {/* Body Type */}
            <StatCard
              label="Body Type"
              value={config.bodyClass === 'GAS_GIANT' ? 'Gas Giant' : 'Rocky'}
              unit=""
            />
          </div>
        </>
      )}

      {/* Footer Info */}
      <div className="p-3 bg-white/5 border border-white/5 rounded-lg">
        <p className="text-[10px] text-white/40 italic">
          High-precision ephemeris data provided by NASA JPL Horizons.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-white/5 rounded-lg p-3 border border-white/10 group transition-colors hover:bg-white/10 flex flex-col justify-between min-w-0">
      <div className="text-[10px] text-white/50 mb-1.5 uppercase tracking-wider group-hover:text-white/70 transition-colors leading-tight">
        {label}
      </div>
      <div className="flex items-baseline gap-1 flex-wrap min-w-0">
        <span className="text-base font-semibold text-white truncate">
          {value}
        </span>
        {unit && (
          <span className="text-[10px] text-white/50 uppercase tracking-tighter shrink-0">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
