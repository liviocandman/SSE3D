'use client';

import { useState } from 'react';
import { Rocket } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  formatDistanceKm,
  formatEventETA,
  formatMissionMET,
  formatSignalLatency,
  formatSolarRange,
  formatVelocityKmH,
  getEarthDistanceDisplay,
  getRadialVelocity,
} from '@/lib/missionFormatters';
import {
  MissionDataSource,
  MissionMode,
  MissionPhase,
  type MissionEventsResponse,
  type MissionHealth,
  type MissionState,
} from '@/lib/missionTypes';
import { useMissionStore } from '@/store/missionStore';

// --- Types ---

interface MissionInfoProps {
  missionState: MissionState | null;
  missionHealth: MissionHealth | null;
  missionEvents: MissionEventsResponse | null;
  isMobile?: boolean;
}

interface MetricItem {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  highlight?: boolean;
}

type BannerTone = 'red' | 'orange' | 'blue' | 'yellow';

// --- Helpers ---

function getPhaseLabel(phase: MissionPhase): string {
  const labels: Record<MissionPhase, string> = {
    [MissionPhase.LAUNCH]: 'Launch',
    [MissionPhase.EARTH_DEPARTURE]: 'Earth Departure',
    [MissionPhase.TRANSLUNAR_COAST]: 'Translunar Coast',
    [MissionPhase.LUNAR_FLYBY]: 'Lunar Flyby',
    [MissionPhase.RETURN_COAST]: 'Return Coast',
    [MissionPhase.REENTRY]: 'Reentry',
    [MissionPhase.SPLASHDOWN]: 'Splashdown',
  };
  return labels[phase] || phase;
}

function getSourceLabel(source: MissionDataSource): string {
  const labels: Record<MissionDataSource, string> = {
    [MissionDataSource.AROW_LIVE]: 'NASA Live Telemetry (AROW)',
    [MissionDataSource.ARCHIVE]: 'OEM Ephemeris Archive',
    [MissionDataSource.SPICE_PREDICTED]: 'SPICE Predicted State',
  };
  return labels[source] || source;
}

function getSourceDescription(source: MissionDataSource): string {
  const descriptions: Record<MissionDataSource, string> = {
    [MissionDataSource.AROW_LIVE]: "Live feed from NASA's Track Artemis API.",
    [MissionDataSource.ARCHIVE]: 'High-fidelity historical records (OEM format).',
    [MissionDataSource.SPICE_PREDICTED]: 'Simulated trajectory based on orbital mechanics.',
  };
  return descriptions[source] || 'Mission data source metadata unavailable.';
}

function formatAttitudeConfidence(confidence?: number): string {
  if (typeof confidence !== 'number') return 'n/a';
  const pct = Math.max(0, Math.min(100, Math.round(confidence * 100)));
  return `${pct}%`;
}

function formatAttitudeLabel(value?: string): string {
  return (value ?? 'n/a').replaceAll('_', ' ');
}

// --- Component ---

export function MissionInfo({ missionState, missionHealth, missionEvents, isMobile = false }: MissionInfoProps) {
  const [showSourceInfo, setShowSourceInfo] = useState(false);
  const { autoFocusEvents, setAutoFocusEvents, estimatedAttitudeEnabled, setEstimatedAttitudeEnabled } = useMissionStore(
    useShallow((state) => ({
      autoFocusEvents: state.autoFocusEvents,
      setAutoFocusEvents: state.setAutoFocusEvents,
      estimatedAttitudeEnabled: state.estimatedAttitudeEnabled,
      setEstimatedAttitudeEnabled: state.setEstimatedAttitudeEnabled,
    }))
  );

  if (!missionState) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-white/50 animate-in fade-in duration-700">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-blue-300/20 bg-blue-500/10 text-blue-200">
          <Rocket size={22} />
        </div>
        <p className="text-sm">Select Orion to view mission details</p>
      </div>
    );
  }

  const isLive = missionState.mode === MissionMode.LIVE;
  const isPredicted = missionState.mode === MissionMode.PREDICTED;
  const isReplay = missionState.mode === MissionMode.REPLAY;
  const freshnessSeconds = missionHealth?.dataAgeSeconds ?? missionState.stalenessSeconds;
  const isStale = isLive && freshnessSeconds > 60;
  const isFallback = missionHealth?.fallbackActive || false;
  const earthDistanceDisplay = getEarthDistanceDisplay(missionState.distances.earthKm);
  const radialVelocity = getRadialVelocity(missionState.position, missionState.velocity);
  const nextEventEta = missionEvents?.nextEvent
    ? formatEventETA(missionEvents.nextEvent.timestamp, missionState.sourceTimestamp)
    : null;
  const phaseLabel = getPhaseLabel(missionState.phase);
  const sourceLabel = getSourceLabel(missionState.source);
  const sourceDescription = getSourceDescription(missionState.source);
  const attitudeSummary = `${formatAttitudeLabel(missionState.attitudeSource)} | ${formatAttitudeLabel(missionState.attitudeMode)} | ${missionState.referenceFrame ?? 'n/a'} | ${formatAttitudeConfidence(missionState.attitudeConfidence)}`;

  const missionMetrics: MetricItem[] = [
    { label: 'Mission Elapsed Time', value: formatMissionMET(missionState.missionElapsedTime), highlight: isLive },
    { label: 'Current Velocity', value: formatVelocityKmH(missionState.velocity), unit: 'km/h' },
    { label: earthDistanceDisplay.label, value: earthDistanceDisplay.value, unit: earthDistanceDisplay.unit },
    { label: 'Distance to Moon', value: formatDistanceKm(missionState.distances.moonKm), unit: 'km' },
    { label: 'Signal Latency', value: formatSignalLatency(missionState.distances.earthKm), note: 'One-way' },
    { label: 'Radial Velocity', value: radialVelocity.value, unit: radialVelocity.unit, note: radialVelocity.direction },
  ];

  const sourceMetrics: MetricItem[] = [
    { label: 'Current Phase', value: phaseLabel, highlight: true },
    { label: 'Data Source', value: sourceLabel },
    { label: 'Freshness', value: isLive ? `${Math.round(freshnessSeconds)} s old` : isReplay ? 'Replay state' : 'Predicted state' },
    ...((missionState.attitudeSource || missionState.referenceFrame)
      ? [{ label: 'Attitude', value: attitudeSummary }]
      : []),
    ...(typeof missionState.solarRangeKm === 'number'
      ? [{ label: 'Solar Range', value: formatSolarRange(missionState.solarRangeKm) }]
      : []),
  ];

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
      <div className="flex flex-col gap-2">
        {isFallback && (
          <StatusBanner tone="red" message="Fallback Mode Active: NASA Live API is currently unreachable." />
        )}

        {isStale && !isFallback && (
          <StatusBanner tone="orange" message={`Telemetry Lag: ${Math.round(freshnessSeconds)}s since last update.`} />
        )}

        {missionState.source === MissionDataSource.ARCHIVE && (
          <StatusBanner tone="blue" message="Archived Data: Viewing validated historical trajectory (OEM). High-fidelity historical records are active." />
        )}

        {missionState.source === MissionDataSource.SPICE_PREDICTED && !isFallback && (
          <StatusBanner tone="yellow" message="Predicted State: Viewing mathematically derived trajectory. Simulated trajectory based on orbital mechanics." />
        )}
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-blue-300/25 bg-blue-500/[0.12] text-blue-100 shadow-[0_0_24px_rgba(37,99,235,0.28)]">
            <Rocket size={22} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-2xl font-semibold leading-tight text-white">Orion</h2>
              <ModePill isLive={isLive} isPredicted={isPredicted} mode={missionState.mode} />
            </div>
            <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-blue-200/60">
              Artemis II Mission
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ToggleButton
          label="Auto Focus"
          active={autoFocusEvents}
          tone="indigo"
          onClick={() => setAutoFocusEvents(!autoFocusEvents)}
        />
        <ToggleButton
          label="Attitude"
          active={estimatedAttitudeEnabled}
          tone="cyan"
          onClick={() => setEstimatedAttitudeEnabled(!estimatedAttitudeEnabled)}
        />
      </div>

      <MetricSection title={isMobile ? 'Mission Snapshot' : 'Mission Overview'} metrics={missionMetrics} />

      <section className="rounded-lg border border-white/10 bg-white/[0.035]">
        <button
          type="button"
          onClick={() => setShowSourceInfo(!showSourceInfo)}
          className="flex w-full items-center justify-between gap-3 border-b border-white/[0.08] px-3 py-2 text-left"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
            Source and Health
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">
            {showSourceInfo ? 'Hide' : 'Details'}
          </span>
        </button>
        {showSourceInfo && (
          <div className="border-b border-white/[0.08] px-3 py-2 text-[11px] leading-relaxed text-white/55">
            {sourceDescription}
          </div>
        )}
        <div className="divide-y divide-white/[0.06]">
          {sourceMetrics.map((metric) => (
            <MetricRow key={`source-${metric.label}`} metric={metric} />
          ))}
        </div>
        {missionState.lineOfSightStatus === 'lunar_occultation' && (
          <div className="mx-3 mb-3 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-red-300">
            LOS - Lunar Occultation
          </div>
        )}
      </section>

      {missionEvents?.nextEvent && (
        <section className="rounded-lg border border-indigo-400/25 bg-indigo-500/10 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-200/75">
              Upcoming Event
            </span>
            {nextEventEta && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-100/65 tabular-nums">
                {nextEventEta}
              </span>
            )}
          </div>
          <h3 className="mt-2 text-sm font-semibold leading-tight text-white">
            {missionEvents.nextEvent.name}
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-white/55">
            {missionEvents.nextEvent.description}
          </p>
        </section>
      )}

      <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
        <p className="text-center text-[10px] leading-relaxed text-white/35">
          Geometric calculations Earth-relative in ECLIPJ2000 frame.
        </p>
      </div>
    </div>
  );
}

function ModePill({ isLive, isPredicted, mode }: { isLive: boolean; isPredicted: boolean; mode: MissionMode }) {
  const className = isLive
    ? 'border-green-400/30 bg-green-500/10 text-green-300'
    : isPredicted
      ? 'border-yellow-400/30 bg-yellow-500/10 text-yellow-300'
      : 'border-blue-400/30 bg-blue-500/10 text-blue-300';

  return (
    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${className}`}>
      {mode.toUpperCase()}
    </span>
  );
}

function ToggleButton({
  label,
  active,
  tone,
  onClick,
}: {
  label: string;
  active: boolean;
  tone: 'indigo' | 'cyan';
  onClick: () => void;
}) {
  const activeClass = tone === 'indigo'
    ? 'border-indigo-300/45 bg-indigo-500/15 text-indigo-100'
    : 'border-cyan-300/45 bg-cyan-500/15 text-cyan-100';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 items-center justify-between gap-2 rounded-lg border px-3 text-[10px] font-bold uppercase tracking-[0.1em] transition-colors ${
        active
          ? activeClass
          : 'border-white/10 bg-white/[0.035] text-white/35 hover:border-white/20 hover:text-white/60'
      }`}
    >
      <span>{label}</span>
      <span className={`relative h-3 w-6 rounded-full ${active ? 'bg-white/35' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 h-2 w-2 rounded-full bg-white transition-all ${active ? 'left-3.5' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

function StatusBanner({ tone, message }: { tone: BannerTone; message: string }) {
  const toneClass: Record<BannerTone, string> = {
    red: 'border-red-400/25 bg-red-500/10 text-red-300',
    orange: 'border-orange-400/25 bg-orange-500/10 text-orange-300',
    blue: 'border-blue-400/25 bg-blue-500/10 text-blue-300',
    yellow: 'border-yellow-400/25 bg-yellow-500/10 text-yellow-300',
  };

  return (
    <div className={`rounded-lg border px-3 py-2 text-[10px] font-bold uppercase leading-relaxed tracking-[0.1em] ${toneClass[tone]}`}>
      {message}
    </div>
  );
}

function MetricSection({ title, metrics }: { title: string; metrics: MetricItem[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035]">
      <h3 className="border-b border-white/[0.08] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
        {title}
      </h3>
      <div className="divide-y divide-white/[0.06]">
        {metrics.map((metric) => (
          <MetricRow key={`${title}-${metric.label}`} metric={metric} />
        ))}
      </div>
    </section>
  );
}

function MetricRow({ metric }: { metric: MetricItem }) {
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
