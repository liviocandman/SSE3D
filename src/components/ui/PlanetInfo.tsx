'use client';

import { useState, type ComponentType } from 'react';
import {
  Bot,
  ChevronDown,
  Compass,
  Gauge,
  Globe2,
  Info,
  Moon,
  Orbit,
  Ruler,
  Sparkles,
  Sun,
  Thermometer,
  Timer,
  Waves,
} from 'lucide-react';

import { REAL_RADII_KM } from '@/lib/scales';
import {
  DEFAULT_BODY_PROFILE,
  DEFAULT_MOON_PROFILE,
  PLANET_PROFILES,
} from '@/lib/planetProfiles';
import { PLANET_CONFIG, PLANET_MOONS } from '@/lib/textureConfig';

// --- Types ---

interface Vector3 {
  x: number;
  y: number;
  z: number;
}

interface PlanetData {
  bodyId: string;
  englishName: string;
  position: Vector3;
  velocity?: Vector3; // km/s from NASA API
  distanceFromSun: number; // million km
  parentName?: string;
  distanceToParentKm?: number;
}

interface PlanetInfoProps {
  planet: PlanetData | null;
  earthPosition?: Vector3;
  onAskAstronomer?: () => void;
}

interface MetricItem {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  highlight?: boolean;
  multiline?: boolean;
}

interface MetricCardItem extends MetricItem {
  icon: MetricIcon;
  tone: MetricTone;
}

type MetricIcon = ComponentType<{ size?: number; className?: string }>;
type MetricTone = 'amber' | 'blue' | 'cyan' | 'green' | 'red' | 'violet';
type PlanetInfoTab = 'overview' | 'astronomer';

// --- Constants ---

const SPEED_OF_LIGHT_KM_S = 299_792.458;

const TABS: Array<{ id: PlanetInfoTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'astronomer', label: 'AI Astronomer' },
];

const metricToneClass: Record<MetricTone, string> = {
  amber: 'border-amber-300/20 bg-amber-400/10 text-amber-200',
  blue: 'border-blue-300/20 bg-blue-400/10 text-blue-200',
  cyan: 'border-cyan-300/20 bg-cyan-400/10 text-cyan-200',
  green: 'border-emerald-300/20 bg-emerald-400/10 text-emerald-200',
  red: 'border-red-300/20 bg-red-400/10 text-red-200',
  violet: 'border-violet-300/20 bg-violet-400/10 text-violet-200',
};

// --- Helper Functions ---

function calculateMillionKmDistance(pos1: Vector3, pos2: Vector3): number {
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

function formatCompactKmFromMillionKm(millionKm: number): { value: string; unit: string } {
  const abs = Math.abs(millionKm);

  if (abs >= 1_000_000) {
    return { value: formatNumber(millionKm / 1_000_000, 2), unit: 'T km' };
  }

  if (abs >= 1_000) {
    return { value: formatNumber(millionKm / 1_000, 2), unit: 'B km' };
  }

  return { value: formatNumber(millionKm), unit: 'M km' };
}

function formatCompactKm(km: number, decimals = 1): { value: string; unit: string } {
  const abs = Math.abs(km);

  if (abs >= 1_000_000_000) {
    return { value: formatNumber(km / 1_000_000_000, 2), unit: 'B km' };
  }

  if (abs >= 1_000_000) {
    return { value: formatNumber(km / 1_000_000, 2), unit: 'M km' };
  }

  return { value: formatNumber(km, decimals), unit: 'km' };
}

function formatDayLength(hours: number): string {
  const absHours = Math.abs(hours);
  const suffix = hours < 0 ? ' retrograde' : '';

  if (absHours >= 24) {
    const days = Math.floor(absHours / 24);
    const remainingHours = Math.round(absHours % 24);
    if (remainingHours > 0) {
      return `${days}d ${remainingHours}h${suffix}`;
    }
    return `${days} days${suffix}`;
  }

  const wholeHours = Math.floor(absHours);
  const minutes = Math.round((absHours - wholeHours) * 60);
  return `${minutes > 0 ? `${wholeHours}h ${minutes}m` : `${wholeHours}h`}${suffix}`;
}

function calculateVelocityMagnitude(velocity: Vector3): number {
  return Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
}

function formatBodyClass(cls: string): string {
  return cls.split('_').map((word) => word.charAt(0) + word.slice(1).toLowerCase()).join(' ');
}

function getBodyGlyph(type: string): string {
  const glyphs: Record<string, string> = {
    STAR: 'SUN',
    PLANET: 'PL',
    DWARF_PLANET: 'DW',
    MOON: 'MO',
  };
  return glyphs[type] || 'PL';
}

function formatTemperature(celsius: number): string {
  return `${celsius > 0 ? '+' : ''}${celsius}`;
}

function formatLightTimeFromMillionKm(millionKm: number): string {
  const seconds = (millionKm * 1_000_000) / SPEED_OF_LIGHT_KM_S;

  if (seconds < 60) {
    return `${formatNumber(seconds, 1)} s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
}

function formatGravityRatio(surfaceGravity: number): string {
  return `${(surfaceGravity / 9.81).toFixed(2)}g`;
}

function getTrackedMoonsLabel(bodyId: string): string {
  const moonCount = PLANET_MOONS[bodyId]?.length ?? 0;
  if (moonCount === 0) return 'None tracked';
  if (moonCount === 1) return '1 tracked moon';
  return `${moonCount} tracked moons`;
}

function buildFallbackProfile(isMoon: boolean) {
  return isMoon ? DEFAULT_MOON_PROFILE : DEFAULT_BODY_PROFILE;
}

// --- Component ---

export function PlanetInfo({ planet, earthPosition, onAskAstronomer }: PlanetInfoProps) {
  const [activeTab, setActiveTab] = useState<PlanetInfoTab>('overview');

  if (!planet) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-white/50 animate-in fade-in duration-700">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full border border-white/10 bg-white/[0.04]" />
        <p className="text-sm">Select a planet to view details</p>
      </div>
    );
  }

  const config = PLANET_CONFIG[planet.bodyId];
  const profile = PLANET_PROFILES[planet.bodyId] ?? buildFallbackProfile(config?.type === 'MOON');
  const planetType = config?.type || 'PLANET';
  const isMoon = planetType === 'MOON';
  const isStar = planetType === 'STAR';
  const orbitalPeriod = config?.orbitalPeriod || 0;
  const realRadiusKm = REAL_RADII_KM[planet.bodyId] || 0;
  const diameterKm = realRadiusKm * 2;

  const orbitalVelocity = (planet.velocity && !isMoon && !isStar)
    ? calculateVelocityMagnitude(planet.velocity)
    : null;

  const fallbackVelocity = (() => {
    if (orbitalVelocity !== null || isStar) return null;

    const orbitalRadius = isMoon && planet.distanceToParentKm != null
      ? planet.distanceToParentKm
      : planet.distanceFromSun * 1e6;

    const orbitalPeriodSeconds = orbitalPeriod * 24 * 60 * 60;
    return orbitalPeriodSeconds > 0
      ? (2 * Math.PI * orbitalRadius) / orbitalPeriodSeconds
      : null;
  })();

  const displayVelocity = orbitalVelocity ?? fallbackVelocity;
  const distanceFromEarth = earthPosition
    ? calculateMillionKmDistance(planet.position, earthPosition)
    : null;
  const fallbackColor = config?.fallbackColor || '#64748b';
  const gravityG = config ? formatGravityRatio(config.surfaceGravity) : null;
  const distanceFromSun = formatCompactKmFromMillionKm(planet.distanceFromSun);
  const distanceFromEarthDisplay = distanceFromEarth !== null
    ? formatCompactKmFromMillionKm(distanceFromEarth)
    : { value: '--', unit: '' };
  const lightTimeFromEarth = distanceFromEarth !== null
    ? formatLightTimeFromMillionKm(distanceFromEarth)
    : '--';
  const distanceToParent = planet.distanceToParentKm != null
    ? formatCompactKm(planet.distanceToParentKm, 0)
    : { value: '--', unit: '' };
  const radiusDisplay = realRadiusKm > 0
    ? formatCompactKm(realRadiusKm, 0)
    : { value: '--', unit: '' };
  const diameterDisplay = diameterKm > 0
    ? formatCompactKm(diameterKm, 0)
    : { value: '--', unit: '' };
  const primaryDistance = isMoon
    ? { label: `Distance to ${planet.parentName ?? 'parent'}`, ...distanceToParent }
    : isStar
      ? { label: 'Distance from Earth', ...distanceFromEarthDisplay }
      : { label: 'Distance from Sun', ...distanceFromSun };

  const keyMetrics: MetricCardItem[] = [
    {
      label: primaryDistance.label,
      value: primaryDistance.value,
      unit: primaryDistance.unit,
      note: isMoon ? 'Current parent range' : 'Current scene range',
      icon: isMoon ? Moon : Sun,
      tone: 'amber',
      highlight: true,
    },
    {
      label: 'Light time from Earth',
      value: lightTimeFromEarth,
      note: 'One-way signal delay',
      icon: Waves,
      tone: 'blue',
    },
    {
      label: 'Orbital velocity',
      value: displayVelocity !== null ? formatNumber(displayVelocity) : '--',
      unit: displayVelocity !== null ? 'km/s' : '',
      note: orbitalVelocity !== null ? 'From ephemeris velocity' : 'Estimated from orbit',
      icon: Gauge,
      tone: 'green',
    },
    {
      label: 'Orbital period',
      value: orbitalPeriod > 0 ? formatNumber(orbitalPeriod, isMoon ? 2 : 0) : '--',
      unit: orbitalPeriod > 0 ? 'days' : '',
      note: isStar ? 'Reference star' : 'One full revolution',
      icon: Timer,
      tone: 'violet',
    },
    {
      label: 'Diameter',
      value: diameterDisplay.value,
      unit: diameterDisplay.unit,
      note: realRadiusKm > 0 ? `Radius ${radiusDisplay.value} ${radiusDisplay.unit}` : 'Catalog value unavailable',
      icon: Ruler,
      tone: 'cyan',
    },
    {
      label: 'Mean temperature',
      value: config ? formatTemperature(config.meanTemperature) : '--',
      unit: config ? 'C' : '',
      note: config ? 'Catalog average' : 'Unavailable',
      icon: Thermometer,
      tone: 'red',
    },
  ];

  const contextMetrics: MetricItem[] = isStar
    ? [
        { label: 'Distance from Earth', value: distanceFromEarthDisplay.value, unit: distanceFromEarthDisplay.unit, highlight: true },
        { label: 'One-way light time', value: lightTimeFromEarth },
        { label: 'Equatorial Radius', value: radiusDisplay.value, unit: radiusDisplay.unit },
        { label: 'Spectral Type', value: 'G2V' },
      ]
    : isMoon
      ? [
          { label: `Distance to ${planet.parentName ?? 'Parent'}`, value: distanceToParent.value, unit: distanceToParent.unit, highlight: true },
          { label: 'Distance from Earth', value: distanceFromEarthDisplay.value, unit: distanceFromEarthDisplay.unit },
          { label: 'One-way light time', value: lightTimeFromEarth },
          { label: 'Catalog class', value: config ? formatBodyClass(config.bodyClass) : 'Moon' },
        ]
      : [
          { label: 'Distance from Sun', value: distanceFromSun.value, unit: distanceFromSun.unit, highlight: true },
          { label: 'Distance from Earth', value: distanceFromEarthDisplay.value, unit: distanceFromEarthDisplay.unit },
          { label: 'One-way light time', value: lightTimeFromEarth },
          { label: 'Tracked moons', value: getTrackedMoonsLabel(planet.bodyId) },
        ];

  const physicalMetrics: MetricItem[] = config
    ? [
        { label: 'Surface Gravity', value: config.surfaceGravity.toFixed(2), unit: `m/s^2 (${gravityG})`, highlight: true },
        { label: 'Day Length', value: formatDayLength(config.dayLength) },
        { label: 'Temperature', value: formatTemperature(config.meanTemperature), unit: 'C' },
        { label: 'Diameter', value: diameterDisplay.value, unit: diameterDisplay.unit },
        { label: 'Axial Tilt', value: `${formatNumber(config.axialTilt, 2)} deg` },
      ]
    : [];

  const orbitalMetrics: MetricItem[] = config && !isStar
    ? [
        { label: 'Semi-Major Axis', value: formatNumber(config.meanDistanceAU, 3), unit: 'AU', highlight: true },
        { label: 'Eccentricity', value: config.eccentricity.toFixed(4) },
        { label: 'Inclination', value: `${config.orbitalInclination.toFixed(2)} deg` },
        { label: 'Orbital Velocity', value: displayVelocity !== null ? formatNumber(displayVelocity) : '--', unit: 'km/s' },
        { label: 'Body Type', value: formatBodyClass(config.bodyClass) },
      ]
    : [];

  const surfaceMetrics: MetricItem[] = [
    ...(config?.surfaceType ? [{ label: 'Surface / Composition', value: config.surfaceType, highlight: true }] : []),
    ...(config?.discoverer ? [{ label: 'Discovered by', value: config.discoverer }] : []),
    { label: 'Surface context', value: profile.surface, multiline: true },
    { label: 'Atmosphere', value: profile.atmosphere, multiline: true },
    { label: 'Exploration', value: profile.exploration, multiline: true },
  ];

  const moonMetrics: MetricItem[] = (PLANET_MOONS[planet.bodyId] ?? []).map((moonId) => {
    const moonConfig = PLANET_CONFIG[moonId];
    return {
      label: moonConfig?.englishName ?? moonId,
      value: moonConfig?.surfaceType ?? 'Tracked moon',
      unit: moonConfig ? `${formatNumber(moonConfig.orbitalPeriod, 2)} days` : undefined,
    };
  });

  return (
    <div
      className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <PlanetHero
        color={fallbackColor}
        glyph={getBodyGlyph(planetType)}
        name={planet.englishName}
        subtitle={
          isMoon && planet.parentName
            ? `Natural Satellite of ${planet.parentName}`
            : planetType.replace('_', ' ')
        }
        summary={profile.summary}
      />

      <div className="grid grid-cols-2 rounded-lg border border-white/10 bg-white/[0.035] p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`h-10 rounded-md text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${
              activeTab === tab.id
                ? 'border border-blue-300/35 bg-blue-500/20 text-blue-100 shadow-[0_0_18px_rgba(59,130,246,0.20)]'
                : 'text-white/45 hover:bg-white/[0.04] hover:text-white/70'
            }`}
            aria-pressed={activeTab === tab.id}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <>
          <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {keyMetrics.map((metric) => (
              <MetricCard key={metric.label} metric={metric} />
            ))}
          </section>

          {config && !isStar && (
            <OrbitSummary
              eccentricity={config.eccentricity}
              inclination={config.orbitalInclination}
              semiMajorAxis={config.meanDistanceAU}
              orbitalPeriod={orbitalPeriod}
            />
          )}

          <MetricSection title="Current Context" icon={Info} metrics={contextMetrics} />

          {physicalMetrics.length > 0 && (
            <CollapsibleMetricSection
              title="Physical Properties"
              icon={Globe2}
              metrics={physicalMetrics}
              defaultOpen
            />
          )}

          {orbitalMetrics.length > 0 && (
            <CollapsibleMetricSection
              title="Orbital Data"
              icon={Orbit}
              metrics={orbitalMetrics}
              defaultOpen={false}
            />
          )}

          {surfaceMetrics.length > 0 && (
            <CollapsibleMetricSection
              title={isMoon ? 'Surface Notes' : 'Atmosphere and Surface'}
              icon={Compass}
              metrics={surfaceMetrics}
              defaultOpen={isMoon}
            />
          )}

          {moonMetrics.length > 0 && (
            <CollapsibleMetricSection
              title="Tracked Moons"
              icon={Moon}
              metrics={moonMetrics}
              badge={String(moonMetrics.length)}
              defaultOpen={false}
            />
          )}

          <DataSourceNote />
        </>
      ) : (
        <AstronomerTab
          planetName={planet.englishName}
          prompts={profile.aiPrompts}
          onAskAstronomer={onAskAstronomer}
        />
      )}
    </div>
  );
}

function PlanetHero({
  color,
  glyph,
  name,
  subtitle,
  summary,
}: {
  color: string;
  glyph: string;
  name: string;
  subtitle: string;
  summary: string;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
      <div className="flex items-start gap-3">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/10 text-[10px] font-black uppercase text-white shadow-lg"
          style={{
            background: `radial-gradient(circle at 30% 25%, ${color}dd, ${color}88 48%, #020617 100%)`,
            boxShadow: `0 0 28px ${color}38`,
          }}
        >
          {glyph}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 truncate text-2xl font-semibold leading-tight text-white">
              {name}
            </h2>
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white/55">
              {subtitle}
            </span>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-white/62">
            {summary}
          </p>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ metric }: { metric: MetricCardItem }) {
  const Icon = metric.icon;

  return (
    <article className="min-h-[6.25rem] rounded-lg border border-white/10 bg-white/[0.035] p-3">
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${metricToneClass[metric.tone]}`}>
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] font-bold uppercase tracking-[0.1em] ${metric.highlight ? 'text-blue-200/80' : 'text-white/[0.46]'}`}>
            {metric.label}
          </div>
          <div className="mt-1 min-w-0">
            <span className="break-words text-xl font-semibold leading-tight text-white tabular-nums">
              {metric.value}
            </span>
            {metric.unit && (
              <span className="ml-1 text-[10px] uppercase tracking-wide text-white/45">
                {metric.unit}
              </span>
            )}
          </div>
          {metric.note && (
            <p className="mt-1 text-[10px] leading-snug text-white/36">
              {metric.note}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function OrbitSummary({
  eccentricity,
  inclination,
  semiMajorAxis,
  orbitalPeriod,
}: {
  eccentricity: number;
  inclination: number;
  semiMajorAxis: number;
  orbitalPeriod: number;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-300/20 bg-blue-400/10 text-blue-200">
            <Orbit size={16} />
          </span>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
            Orbit Snapshot
          </h3>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-white/35">
          {formatNumber(orbitalPeriod, 0)} days
        </span>
      </div>
      <div className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.06] bg-black/15">
        <MiniMetric label="Semi-major axis" value={formatNumber(semiMajorAxis, 3)} unit="AU" />
        <MiniMetric label="Eccentricity" value={eccentricity.toFixed(4)} />
        <MiniMetric label="Inclination" value={`${inclination.toFixed(2)} deg`} />
      </div>
    </section>
  );
}

function MiniMetric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
      <span className="min-w-0 text-[10px] font-bold uppercase tracking-[0.1em] text-white/38">
        {label}
      </span>
      <span className="text-right text-sm font-semibold text-white tabular-nums">
        {value}
        {unit && <span className="ml-1 text-[10px] uppercase text-white/42">{unit}</span>}
      </span>
    </div>
  );
}

function MetricSection({
  title,
  icon,
  metrics,
}: {
  title: string;
  icon: MetricIcon;
  metrics: MetricItem[];
}) {
  const Icon = icon;

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035]">
      <div className="flex items-center gap-2 border-b border-white/[0.08] px-3 py-2">
        <Icon size={14} className="text-blue-200/70" />
        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
          {title}
        </h3>
      </div>
      <div className="divide-y divide-white/[0.06]">
        {metrics.map((metric) => (
          <MetricRow key={`${title}-${metric.label}`} metric={metric} />
        ))}
      </div>
    </section>
  );
}

function CollapsibleMetricSection({
  title,
  icon,
  metrics,
  badge,
  defaultOpen,
}: {
  title: string;
  icon: MetricIcon;
  metrics: MetricItem[];
  badge?: string;
  defaultOpen?: boolean;
}) {
  const Icon = icon;
  const [isOpen, setIsOpen] = useState(defaultOpen ?? false);

  return (
    <details
      className="group rounded-lg border border-white/10 bg-white/[0.035]"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3">
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-blue-200/70">
            <Icon size={15} />
          </span>
          <span className="truncate text-xs font-bold uppercase tracking-[0.14em] text-white/55">
            {title}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {badge && (
            <span className="rounded-md border border-blue-300/25 bg-blue-400/10 px-2 py-0.5 text-[10px] font-bold text-blue-200">
              {badge}
            </span>
          )}
          <ChevronDown size={16} className="text-white/35 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="divide-y divide-white/[0.06] border-t border-white/[0.08]">
        {metrics.map((metric) => (
          <MetricRow key={`${title}-${metric.label}`} metric={metric} />
        ))}
      </div>
    </details>
  );
}

function MetricRow({ metric }: { metric: MetricItem }) {
  if (metric.multiline) {
    return (
      <div className="px-3 py-3">
        <div className={`text-[10px] font-bold uppercase tracking-[0.11em] ${metric.highlight ? 'text-blue-200/80' : 'text-white/[0.42]'}`}>
          {metric.label}
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-white/62">
          {metric.value}
        </p>
      </div>
    );
  }

  return (
    <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className={`text-[10px] font-bold uppercase tracking-[0.11em] ${metric.highlight ? 'text-blue-200/80' : 'text-white/[0.42]'}`}>
          {metric.label}
        </div>
        {metric.note && (
          <div className="mt-1 text-[10px] uppercase tracking-wide text-white/35">
            {metric.note}
          </div>
        )}
      </div>
      <div className="min-w-0 text-right">
        <span className={`break-words text-sm font-semibold tabular-nums leading-tight ${metric.highlight ? 'text-blue-100' : 'text-white'}`}>
          {metric.value}
        </span>
        {metric.unit && (
          <span className={`ml-1 text-[10px] uppercase tracking-wide ${metric.highlight ? 'text-blue-200/60' : 'text-white/45'}`}>
            {metric.unit}
          </span>
        )}
      </div>
    </div>
  );
}

function AstronomerTab({
  planetName,
  prompts,
  onAskAstronomer,
}: {
  planetName: string;
  prompts: string[];
  onAskAstronomer?: () => void;
}) {
  return (
    <section className="rounded-lg border border-blue-400/25 bg-blue-500/10 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-300/25 bg-blue-400/10 text-blue-100">
          <Bot size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-white">
            Ask about {planetName}
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-blue-100/60">
            Open the contextual astronomer to ask questions about orbit, scale, composition, observation, or comparisons with Earth.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={onAskAstronomer}
            className="group flex min-h-12 w-full items-center gap-3 rounded-lg border border-white/10 bg-black/18 px-3 py-2 text-left transition-colors hover:border-blue-300/35 hover:bg-blue-400/10"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-300/20 bg-blue-400/10 text-blue-100">
              <Sparkles size={15} />
            </span>
            <span className="min-w-0 text-[12px] leading-snug text-white/70 group-hover:text-white">
              {prompt}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onAskAstronomer}
        disabled={!onAskAstronomer}
        className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-blue-300/35 bg-blue-500/20 text-xs font-bold uppercase tracking-[0.12em] text-blue-100 transition-colors hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Sparkles size={15} />
        Open AI Astronomer
      </button>
    </section>
  );
}

function DataSourceNote() {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
      <p className="text-[10px] leading-relaxed text-white/35">
        Positions and motion are driven by NASA NAIF SPICE ephemeris data. Catalog properties are used for physical summaries.
      </p>
    </div>
  );
}
