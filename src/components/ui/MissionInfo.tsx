'use client';

import React from 'react';
import { 
  MissionState, 
  MissionHealth, 
  MissionEventsResponse, 
  MissionMode,
  MissionDataSource,
  MissionPhase
} from '@/lib/missionTypes';

// --- Types ---

interface MissionInfoProps {
  missionState: MissionState | null;
  missionHealth: MissionHealth | null;
  missionEvents: MissionEventsResponse | null;
}

// --- Helper Functions ---

function formatNumber(num: number, decimals = 0): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(num);
}

function formatVelocity(velocity: { x: number; y: number; z: number }): string {
  const magnitudeKmS = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
  const magnitudeKmH = magnitudeKmS * 3600;
  return formatNumber(magnitudeKmH);
}

function formatMET(elapsed: string): string {
  if (!elapsed) return 'T+ 00:00:00:00';
  if (elapsed.startsWith('T+')) return elapsed;

  const [daysPart = '0', timePart = '00:00:00'] = elapsed.split('-');
  const dayCount = Number.parseInt(daysPart, 10);
  const [hoursRaw = '0', minutesRaw = '0', secondsRaw = '0'] = timePart.split(':');

  const pad2 = (value: string | number) => String(value).padStart(2, '0');
  const safeDays = Number.isFinite(dayCount) ? Math.max(dayCount, 0) : 0;

  return `T+ ${pad2(safeDays)}:${pad2(hoursRaw)}:${pad2(minutesRaw)}:${pad2(secondsRaw)}`;
}

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

// --- Component ---

export function MissionInfo({ missionState, missionHealth, missionEvents }: MissionInfoProps) {
  if (!missionState) {
    return (
      <div className="text-center py-8 px-4 text-white/50 animate-in fade-in duration-700">
        <div className="text-5xl mb-4 opacity-50">🚀</div>
        <p>Select Orion to view mission details</p>
      </div>
    );
  }

  const isLive = missionState.mode === MissionMode.LIVE;
  const isPredicted = missionState.mode === MissionMode.PREDICTED;
  const isReplay = missionState.mode === MissionMode.REPLAY;
  
  const freshnessSeconds = missionHealth?.dataAgeSeconds ?? missionState.stalenessSeconds;
  const isStale = isLive && freshnessSeconds > 60;
  const isFallback = missionHealth?.fallbackActive || false;

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
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-2xl bg-gradient-to-br from-blue-600 to-blue-900 shadow-[0_0_20px_rgba(37,99,235,0.4)] border border-blue-400/30"
          >
            🚀
          </div>
          <div className="flex flex-col">
            <h2 className="text-2xl font-semibold text-white m-0">
              Orion
            </h2>
            <span className="text-sm text-white/50 uppercase tracking-widest">
              Artemis II Mission
            </span>
          </div>
        </div>

        {/* Mode Badge */}
        <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border ${
          isLive ? 'bg-green-500/20 text-green-400 border-green-500/40' :
          isPredicted ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40' :
          'bg-blue-500/20 text-blue-400 border-blue-500/40'
        }`}>
          {missionState.mode.toUpperCase()}
        </div>
      </div>

      {/* Primary Mission Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Mission Elapsed Time"
          value={formatMET(missionState.missionElapsedTime)}
          unit=""
          highlight={isLive}
        />
        <StatCard
          label="Current Velocity"
          value={formatVelocity(missionState.velocity)}
          unit="km/h"
        />
        <StatCard
          label="Distance from Earth"
          value={formatNumber(missionState.distances.earthKm)}
          unit="km"
        />
        <StatCard
          label="Distance to Moon"
          value={formatNumber(missionState.distances.moonKm)}
          unit="km"
        />
      </div>

      {/* Mission Status / Phase Section */}
      <div className="bg-white/5 rounded-lg p-3 border border-white/10 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-white/50 uppercase tracking-wider">Current Phase</span>
          <span className="text-xs font-bold text-blue-400">{getPhaseLabel(missionState.phase)}</span>
        </div>
        
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-white/50 uppercase tracking-wider">Data Source</span>
          <span className="text-[10px] text-white/80 text-right max-w-[150px] truncate" title={getSourceLabel(missionState.source)}>
            {getSourceLabel(missionState.source)}
          </span>
        </div>

        {(isStale || isFallback) && (
          <div className={`mt-1 flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-bold uppercase ${
            isFallback ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
          }`}>
            <span>⚠️</span>
            <span>{isFallback ? 'Fallback Data Active' : `Stale Data: ${Math.round(freshnessSeconds)}s`}</span>
          </div>
        )}
      </div>

      {/* Next Event Section */}
      {missionEvents?.nextEvent && (
        <div className="relative overflow-hidden group rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-900/20 to-purple-900/20 p-3">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-indigo-300 tracking-wide uppercase">
              Upcoming Event
            </span>
            <span className="text-sm font-semibold text-white">
              {missionEvents.nextEvent.name}
            </span>
            <span className="text-[11px] text-white/60">
              {missionEvents.nextEvent.description}
            </span>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <div className="p-3 bg-white/5 border border-white/5 rounded-lg">
        <p className="text-[10px] text-white/40 italic text-center">
          Geometric calculations Earth-relative in ECLIPJ2000 frame.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value, unit, highlight = false }: { label: string; value: string; unit: string, highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border transition-colors flex flex-col justify-between min-w-0 ${
      highlight 
        ? 'bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20' 
        : 'bg-white/5 border-white/10 hover:bg-white/10'
    }`}>
      <div className={`text-[10px] mb-1.5 uppercase tracking-wider leading-tight transition-colors ${
        highlight ? 'text-blue-300' : 'text-white/50'
      }`}>
        {label}
      </div>
      <div className="flex items-baseline gap-1 flex-wrap min-w-0">
        <span className={`text-base font-semibold truncate ${highlight ? 'text-blue-100' : 'text-white'}`}>
          {value}
        </span>
        {unit && (
          <span className={`text-[10px] uppercase tracking-tighter shrink-0 ${highlight ? 'text-blue-400' : 'text-white/50'}`}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
