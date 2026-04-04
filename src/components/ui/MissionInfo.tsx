'use client';

import React, { useState } from 'react';
import { 
  MissionState, 
  MissionHealth, 
  MissionEventsResponse, 
  MissionMode,
  MissionDataSource,
  MissionPhase
} from '@/lib/missionTypes';
import { useMissionStore } from '@/store/missionStore';
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

// --- Types ---

interface MissionInfoProps {
  missionState: MissionState | null;
  missionHealth: MissionHealth | null;
  missionEvents: MissionEventsResponse | null;
  isMobile?: boolean;
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

export function MissionInfo({ missionState, missionHealth, missionEvents, isMobile = false }: MissionInfoProps) {
  const [showSourceInfo, setShowSourceInfo] = useState(false);
  const { autoFocusEvents, setAutoFocusEvents } = useMissionStore(
    useShallow((state) => ({
      autoFocusEvents: state.autoFocusEvents,
      setAutoFocusEvents: state.setAutoFocusEvents,
    }))
  );

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
  const earthDistanceDisplay = getEarthDistanceDisplay(missionState.distances.earthKm);
  const radialVelocity = getRadialVelocity(missionState.position, missionState.velocity);
  const nextEventEta = missionEvents?.nextEvent
    ? formatEventETA(missionEvents.nextEvent.timestamp, missionState.sourceTimestamp)
    : null;

  if (isMobile) {
    return (
      <div 
        className="flex flex-col gap-5 animate-in fade-in slide-in-from-bottom-2 duration-500"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Mobile Header: High Priority Context */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-white tracking-tight">Orion</h2>
              <div className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter border ${
                isLive ? 'bg-green-500/20 text-green-400 border-green-500/40' :
                isPredicted ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40' :
                'bg-blue-500/20 text-blue-400 border-blue-500/40'
              }`}>
                {missionState.mode.toUpperCase()}
              </div>
            </div>
            <div className="text-xs font-bold text-blue-400 uppercase tracking-widest flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_5px_#3b82f6]" />
              {getPhaseLabel(missionState.phase)}
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-2">
            <button 
              onClick={() => setAutoFocusEvents(!autoFocusEvents)}
              className={`px-2 py-1 rounded border transition-all flex items-center gap-1.5 ${
                autoFocusEvents 
                  ? 'bg-indigo-500/20 border-indigo-400 text-indigo-300' 
                  : 'bg-white/5 border-white/10 text-white/30'
              }`}
              title="Auto Focus major events"
            >
              <span className="text-[8px] font-black uppercase tracking-tighter">Auto Focus</span>
              <div className={`w-4 h-2 rounded-full relative ${autoFocusEvents ? 'bg-indigo-500' : 'bg-zinc-700'}`}>
                <div className={`absolute top-0.5 w-1 h-1 rounded-full bg-white transition-all ${autoFocusEvents ? 'left-2.5' : 'left-0.5'}`} />
              </div>
            </button>
            <div className="flex flex-col items-end gap-0.5 text-right">
              <span className="text-[9px] text-white/40 uppercase tracking-widest leading-none font-bold">MET</span>
              <span className="text-lg font-mono font-bold text-blue-100 tabular-nums leading-none">
                {formatMissionMET(missionState.missionElapsedTime)}
              </span>
            </div>
          </div>
        </div>

        {/* Primary Mobile Metrics */}
        <div className="grid grid-cols-2 gap-2">
          <StatCard
            label={earthDistanceDisplay.label}
            value={earthDistanceDisplay.value}
            unit={earthDistanceDisplay.unit}
            highlight
          />
          <StatCard
            label="Distance to Moon"
            value={formatDistanceKm(missionState.distances.moonKm)}
            unit="km"
            highlight
          />
        </div>

        {/* Next Event - High Priority on Mobile */}
        {missionEvents?.nextEvent && (
          <div className="rounded-xl border border-blue-500/30 bg-blue-600/5 p-3 flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-black text-blue-400 tracking-tighter uppercase">Next Milestone</span>
              {nextEventEta && (
                <span className="text-[10px] font-bold text-blue-200 tabular-nums">{nextEventEta}</span>
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-white leading-tight">{missionEvents.nextEvent.name}</span>
              <span className="text-[11px] text-white/60 line-clamp-1">{missionEvents.nextEvent.description}</span>
            </div>
          </div>
        )}

        {/* Secondary Telemetry - Below the main mobile fold */}
        <div className="flex flex-col gap-3 pt-2 border-t border-white/5">
          <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Secondary Telemetry</h3>
          <div className="grid grid-cols-2 gap-2 opacity-80">
            <StatCard
              label="Velocity"
              value={formatVelocityKmH(missionState.velocity)}
              unit="km/h"
            />
            <StatCard
              label="Signal Delay"
              value={formatSignalLatency(missionState.distances.earthKm)}
              unit=""
            />
          </div>
          
          {/* Status & Source Section */}
          <div className="bg-white/5 rounded-lg p-3 flex flex-col gap-2.5">
            <div 
              className="flex justify-between items-center relative"
              onClick={() => setShowSourceInfo(!showSourceInfo)}
            >
              <span className="text-[10px] text-white/40 uppercase tracking-wider underline decoration-dotted decoration-white/20">Data Source</span>
              <span className="text-[10px] text-white/70 font-bold">{getSourceLabel(missionState.source)}</span>
              {showSourceInfo && (
                <div className="absolute bottom-full right-0 mb-2 w-full p-2 bg-blue-900/90 backdrop-blur-md border border-blue-400/30 rounded text-[10px] text-white z-50">
                  {missionState.source === MissionDataSource.AROW_LIVE && "Live feed from NASA's Track Artemis API."}
                  {missionState.source === MissionDataSource.ARCHIVE && "High-fidelity historical records (OEM format)."}
                  {missionState.source === MissionDataSource.SPICE_PREDICTED && "Simulated trajectory based on orbital mechanics."}
                </div>
              )}
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-white/40 uppercase tracking-wider">Telemetry Freshness</span>
              <span className="text-[10px] text-white/70 tabular-nums">
                {isLive ? `${Math.round(freshnessSeconds)}s old` : 'Static / Replay'}
              </span>
            </div>

            {missionState.lineOfSightStatus === 'lunar_occultation' && (
              <div className="mt-1 flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] font-black uppercase bg-red-500/20 text-red-400 border border-red-500/30">
                <span>📡</span>
                <span>LOS - Lunar Occultation</span>
              </div>
            )}
          </div>
        </div>

        {/* Observability Banners (Mobile) */}
        {(isFallback || isStale) && (
          <div className="flex flex-col gap-2">
            {isFallback && (
              <div className="bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg p-2 text-[10px] font-bold uppercase flex items-center gap-2">
                <span>🚨</span>
                <span>NASA API Unreachable</span>
              </div>
            )}
            {isStale && !isFallback && (
              <div className="bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-lg p-2 text-[10px] font-bold uppercase flex items-center gap-2">
                <span>⚠️</span>
                <span>Telemetry Lag Detected</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Desktop Layout
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
      {/* Observability Banners */}
      <div className="flex flex-col gap-2">
        {isFallback && (
          <div className="bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg p-2 text-[10px] font-bold uppercase tracking-wide flex items-center gap-2">
            <span className="text-xs">🚨</span>
            <span>Fallback Mode Active: NASA Live API is currently unreachable.</span>
          </div>
        )}
        
        {isStale && !isFallback && (
          <div className="bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-lg p-2 text-[10px] font-bold uppercase tracking-wide flex items-center gap-2">
            <span className="text-xs">⚠️</span>
            <span>Telemetry Lag: {Math.round(freshnessSeconds)}s since last update.</span>
          </div>
        )}

        {missionState.source === MissionDataSource.ARCHIVE && (
          <div className="bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg p-2 text-[10px] font-bold uppercase tracking-wide flex items-center gap-2">
            <span className="text-xs">📚</span>
            <span>Archived Data: Viewing validated historical trajectory (OEM).</span>
          </div>
        )}

        {missionState.source === MissionDataSource.SPICE_PREDICTED && !isFallback && (
          <div className="bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-lg p-2 text-[10px] font-bold uppercase tracking-wide flex items-center gap-2">
            <span className="text-xs">🔮</span>
            <span>Predicted State: Viewing mathematically derived trajectory.</span>
          </div>
        )}
      </div>

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

        <div className="flex flex-col items-end gap-2">
          {/* Mode Badge */}
          <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border ${
            isLive ? 'bg-green-500/20 text-green-400 border-green-500/40' :
            isPredicted ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40' :
            'bg-blue-500/20 text-blue-400 border-blue-500/40'
          }`}>
            {missionState.mode.toUpperCase()}
          </div>

          {/* Auto Focus Toggle */}
          <button 
            onClick={() => setAutoFocusEvents(!autoFocusEvents)}
            className={`flex items-center gap-2 px-2 py-1 rounded border text-[9px] font-bold uppercase transition-all ${
              autoFocusEvents 
                ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-400' 
                : 'bg-white/5 border-white/10 text-white/30 hover:text-white/50'
            }`}
          >
            <span>Auto Focus</span>
            <div className={`w-5 h-2.5 rounded-full relative ${autoFocusEvents ? 'bg-indigo-500' : 'bg-zinc-700'}`}>
              <div className={`absolute top-0.5 w-1.5 h-1.5 rounded-full bg-white transition-all ${autoFocusEvents ? 'left-3' : 'left-0.5'}`} />
            </div>
          </button>
        </div>
      </div>

      {/* Primary Mission Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Mission Elapsed Time"
          value={formatMissionMET(missionState.missionElapsedTime)}
          unit=""
          highlight={isLive}
        />
        <StatCard
          label="Current Velocity"
          value={formatVelocityKmH(missionState.velocity)}
          unit="km/h"
        />
        <StatCard
          label={earthDistanceDisplay.label}
          value={earthDistanceDisplay.value}
          unit={earthDistanceDisplay.unit}
        />
        <StatCard
          label="Distance to Moon"
          value={formatDistanceKm(missionState.distances.moonKm)}
          unit="km"
        />
        <StatCard
          label="Signal Latency"
          value={formatSignalLatency(missionState.distances.earthKm)}
          unit=""
          note="One-way"
        />
        <StatCard
          label="Radial Velocity"
          value={radialVelocity.value}
          unit={radialVelocity.unit}
          note={radialVelocity.direction}
        />
      </div>

      {/* Mission Status / Phase Section */}
      <div className="bg-white/5 rounded-lg p-3 border border-white/10 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-white/50 uppercase tracking-wider">Current Phase</span>
          <span className="text-xs font-bold text-blue-400">{getPhaseLabel(missionState.phase)}</span>
        </div>
        
        <div 
          className="flex justify-between items-center group cursor-help relative"
          onClick={() => setShowSourceInfo(!showSourceInfo)}
        >
          <span className="text-[10px] text-white/50 uppercase tracking-wider underline decoration-dotted decoration-white/20">Data Source</span>
          <span className="text-[10px] text-white/80 text-right max-w-[150px] truncate" title={getSourceLabel(missionState.source)}>
            {getSourceLabel(missionState.source)}
          </span>
          
          {/* Tooltip-like explainer for Source - supports hover AND click for mobile */}
          <div className={`absolute bottom-full right-0 mb-2 w-48 p-2 bg-black/90 border border-white/10 rounded shadow-xl text-[9px] text-white/70 transition-opacity z-50 pointer-events-none ${
            showSourceInfo ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}>
            {missionState.source === MissionDataSource.AROW_LIVE && "Live feed from NASA's Track Artemis API."}
            {missionState.source === MissionDataSource.ARCHIVE && "High-fidelity historical records (OEM format)."}
            {missionState.source === MissionDataSource.SPICE_PREDICTED && "Simulated trajectory based on orbital mechanics."}
          </div>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-[10px] text-white/50 uppercase tracking-wider">Freshness</span>
          <span className="text-[10px] text-white/70 tabular-nums">
            {isLive ? `${Math.round(freshnessSeconds)} s old` : isReplay ? 'Replay state' : 'Predicted state'}
          </span>
        </div>

        {typeof missionState.solarRangeKm === 'number' && (
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-white/50 uppercase tracking-wider">Solar Range</span>
            <span className="text-[10px] text-white/70 tabular-nums">
              {formatSolarRange(missionState.solarRangeKm)}
            </span>
          </div>
        )}

        {missionState.lineOfSightStatus === 'lunar_occultation' && (
          <div className="mt-1 flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/30">
            <span>📡</span>
            <span>LOS - Lunar Occultation</span>
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
            {nextEventEta && (
              <span className="text-[10px] text-indigo-200/80 uppercase tracking-wide tabular-nums">
                {nextEventEta}
              </span>
            )}
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

function StatCard({
  label,
  value,
  unit,
  highlight = false,
  note,
}: {
  label: string;
  value: string;
  unit: string;
  highlight?: boolean;
  note?: string;
}) {
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
        <span className={`text-base font-semibold truncate tabular-nums ${highlight ? 'text-blue-100' : 'text-white'}`}>
          {value}
        </span>
        {unit && (
          <span className={`text-[10px] uppercase tracking-tighter shrink-0 ${highlight ? 'text-blue-400' : 'text-white/50'}`}>
            {unit}
          </span>
        )}
      </div>
      {note && (
        <div className={`mt-1 text-[10px] uppercase tracking-wide ${highlight ? 'text-blue-300/80' : 'text-white/40'}`}>
          {note}
        </div>
      )}
    </div>
  );
}
