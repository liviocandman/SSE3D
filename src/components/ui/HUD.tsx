"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { PlanetInfo } from "./PlanetInfo";
import { MissionInfo } from "./MissionInfo";
import { AstronomerModal } from "./AstronomerModal";
import { AuthModal } from "./AuthModal";
import { FavoritesModal } from "./FavoritesModal";
import { useSolarStore } from "@/store/solarStore";
import { useMissionStore } from "@/store/missionStore";
import { useUIStore } from "@/store/uiStore";
import { useShallow } from "zustand/react/shallow";
import { ChevronLeft, ChevronRight, Heart, Maximize2, Minimize2, Rocket } from "lucide-react";
import { useFavorites } from "@/hooks/useFavorites";
import { TimeTravelControls } from "./TimeTravelControls";

// --- Types ---

interface HUDProps {
  earthPosition?: { x: number; y: number; z: number };
  onDateChange: (date: string) => void;
  onRefresh?: () => void;
  isFallback?: boolean;
}

// --- Hook for responsive detection ---

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkMobile = () => setIsMobile(window.innerWidth < 768);

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return isMobile;
}

// --- Helpers ---

function getPlanetAccentClass(bodyId: string): string {
  const mapping: Record<string, string> = {
    "10": "border-sun shadow-sun/20",
    "199": "border-mercury shadow-mercury/20",
    "299": "border-venus shadow-venus/20",
    "399": "border-earth shadow-earth/20",
    "499": "border-mars shadow-mars/20",
    "599": "border-jupiter shadow-jupiter/20",
    "699": "border-saturn shadow-saturn/20",
    "799": "border-uranus shadow-uranus/20",
    "899": "border-neptune shadow-neptune/20",
  };
  return mapping[bodyId] || "border-white/20 shadow-white/10";
}

// --- Component ---

export function HUD({
  earthPosition,
  isFallback = false,
}: HUDProps) {
  const isMobile = useIsMobile();
  
  const { selectedPlanet, viewMode, toggleViewMode, setSelectedPlanet } = useSolarStore(
    useShallow((state) => ({
      selectedPlanet: state.selectedPlanet,
      viewMode: state.viewMode,
      toggleViewMode: state.toggleViewMode,
      setSelectedPlanet: state.setSelectedPlanet,
    }))
  );

  const { 
    missionState, 
    missionHealth, 
    missionEvents, 
    selectedMissionTargetId, 
    setSelectedMissionTargetId 
  } = useMissionStore(
    useShallow((state) => ({
      missionState: state.missionState,
      missionHealth: state.missionHealth,
      missionEvents: state.missionEvents,
      selectedMissionTargetId: state.selectedMissionTargetId,
      setSelectedMissionTargetId: state.setSelectedMissionTargetId,
    }))
  );

  const openFavorites = useUIStore((state) => state.openFavorites);
  const { data: favorites = [] } = useFavorites();
  const [isAstronomerOpen, setIsAstronomerOpen] = useState(false);
  // Start expanded if planet or mission is already selected, otherwise collapsed
  const [isExpanded, setIsExpanded] = useState(() => !!selectedPlanet || !!selectedMissionTargetId);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDesktopExpanded, setIsDesktopExpanded] = useState(false);
  const missionVehicleId = missionState?.vehicleId ?? null;
  const isMissionSelected = !!missionVehicleId && selectedMissionTargetId === missionVehicleId;

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const toggleDesktopExpanded = () => {
    setIsMinimized(false);
    setIsDesktopExpanded((prev) => !prev);
  };

  // Always reopen the desktop drawer when a different planet or mission is selected.
  useEffect(() => {
    if (!isMobile && (selectedPlanet?.bodyId || selectedMissionTargetId)) {
      const timeoutId = setTimeout(() => {
        setIsMinimized(false);
      }, 0);

      return () => clearTimeout(timeoutId);
    }
  }, [isMobile, selectedPlanet?.bodyId, selectedMissionTargetId]);

  const handleMissionToggle = () => {
    if (selectedMissionTargetId) {
      setSelectedMissionTargetId(null);
    } else if (missionVehicleId) {
      setSelectedPlanet(null);
      setSelectedMissionTargetId(missionVehicleId);
    }
  };
  const missionToggleDisabled = !missionVehicleId;

  const accentClass = isMissionSelected
    ? "border-blue-500 shadow-blue-500/20"
    : selectedPlanet
      ? getPlanetAccentClass(selectedPlanet.bodyId)
      : "border-white/10 shadow-black/40";
  const inspectorTitle = isMissionSelected
    ? "Artemis II"
    : selectedPlanet?.englishName ?? "Solar Explorer";
  const inspectorContext = isMissionSelected
    ? "Mission Control"
    : selectedPlanet
      ? "Solar Explorer"
      : "Inspector";
  const desktopPanelWidthClass = isDesktopExpanded
    ? "w-[min(44rem,calc(100vw-1.5rem))] md:w-[min(38rem,calc(100vw-1.5rem))] lg:w-[42rem] xl:w-[46rem]"
    : "w-[min(24rem,calc(100vw-1.5rem))] md:w-[22rem] lg:w-[24rem] xl:w-[25rem]";

  const hudContent = (
    <div className="space-y-4 pt-1">
      <div className="flex items-center justify-between md:hidden">
        <div className="flex items-center gap-2">
          <button
            onClick={openFavorites}
            className="relative p-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-md transition-colors group"
            title="Favoritos"
          >
            <Heart className={`h-4 w-4 ${favorites.length > 0 ? 'text-red-500 fill-red-500' : 'text-zinc-400'}`} />
            {favorites.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white">
                {favorites.length}
              </span>
            )}
          </button>

          <button
            onClick={handleMissionToggle}
            className={`inline-flex items-center gap-1.5 px-2 py-1 border rounded-md text-[10px] font-bold uppercase transition-all ${
              isMissionSelected 
                ? 'bg-blue-600 border-blue-400 text-white shadow-[0_0_10px_rgba(37,99,235,0.5)]' 
                : 'bg-zinc-800/50 border-white/10 text-zinc-400 hover:bg-zinc-700/50 hover:border-white/20'
            }`}
            title={missionToggleDisabled ? "Mission data unavailable" : "Toggle Mission Context"}
            disabled={missionToggleDisabled}
          >
            <Rocket size={12} className={isMissionSelected ? 'animate-pulse' : ''} />
            <span>Mission</span>
          </button>

          <button
            onClick={toggleViewMode}
            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-md text-[10px] font-bold text-blue-400 uppercase transition-colors"
            title={
              viewMode === "didactic"
                ? "Switch to realistic scale"
                : "Switch to didactic scale"
            }
          >
            <span>{viewMode === "didactic" ? "📐" : "🔭"}</span>
            <span>
              {viewMode === "didactic" ? "Didactic" : "Realistic"}
            </span>
          </button>
        </div>
        {isFallback && (
          <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-md text-[10px] font-bold text-yellow-500 uppercase">
            <span>⚠️</span>
            <span>Offline</span>
          </div>
        )}
      </div>

      {/* Info Routing */}
      {isMissionSelected ? (
        <MissionInfo 
          missionState={missionState}
          missionHealth={missionHealth}
          missionEvents={missionEvents}
          isMobile={isMobile}
        />
      ) : (
        <PlanetInfo
          planet={selectedPlanet}
          earthPosition={earthPosition}
          onAskAstronomer={() => setIsAstronomerOpen(true)}
        />
      )}
    </div>
  );

  if (isMobile) {
    return (
      <>
        <div
          className={`fixed bottom-0 left-0 right-0 z-[100] flex flex-col overflow-hidden rounded-t-xl border-t border-white/15 bg-black/70 shadow-2xl shadow-black/60 backdrop-blur-2xl transition-all duration-500 ease-in-out hardware-accel ${accentClass}`}
          style={{ 
            height: isExpanded ? "min(72dvh, calc(100dvh - 88px))" : "max(68px, calc(68px + env(safe-area-inset-bottom)))",
            paddingBottom: isExpanded ? "env(safe-area-inset-bottom)" : "0"
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {/* Drag handle area */}
          <div
            className="flex h-8 w-full cursor-pointer items-center justify-center"
            onClick={toggleExpand}
          >
            <div className="h-1 w-10 rounded-full bg-white/30" />
          </div>

          {/* Collapsed preview */}
          {!isExpanded && (
            <div
              className="flex cursor-pointer items-center justify-between px-5 pb-4"
              onClick={toggleExpand}
            >
              <div className="min-w-0">
                <span className="block truncate text-base font-semibold tracking-tight">
                  {isMissionSelected ? "Artemis II" : selectedPlanet ? selectedPlanet.englishName : "Solar Explorer"}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                  Tap to explore
                </span>
              </div>
            </div>
          )}

          {/* Expanded content */}
          <div
            className={`flex-1 overflow-y-auto px-4 pb-6 transition-opacity duration-300 sm:px-6 ${isExpanded ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          >
            {hudContent}
          </div>
        </div>
        <TimeTravelControls />
        <AstronomerModal
          isOpen={isAstronomerOpen}
          onClose={() => setIsAstronomerOpen(false)}
          planet={selectedPlanet}
        />
        <AuthModal />
        <FavoritesModal />
      </>
    );
  }

  // Desktop sidebar
  return (
    <>
      {isMinimized && (
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          className={`fixed right-3 top-3 z-[120] flex max-w-[min(18rem,calc(100vw-1.5rem))] items-center gap-3 rounded-xl border bg-black/[0.68] px-3 py-2 text-left shadow-2xl shadow-black/50 backdrop-blur-2xl transition-colors hover:bg-black/[0.78] hover:text-white ${accentClass}`}
          title="Show panel"
          aria-label={`Show ${inspectorTitle} panel`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-white/70">
            <ChevronLeft size={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">
              {inspectorContext}
            </span>
            <span className="block truncate text-sm font-semibold leading-tight text-white/85">
              {inspectorTitle}
            </span>
          </span>
        </button>
      )}

      <motion.div
        initial={false}
        animate={{
          x: isMinimized ? "calc(100% + 1rem)" : 0,
          opacity: isMinimized ? 0 : (selectedPlanet || isMissionSelected) ? 1 : 0.95,
        }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className={`fixed bottom-3 right-3 top-3 z-[100] flex ${desktopPanelWidthClass} flex-col overflow-hidden rounded-xl border border-white/10 bg-black/[0.62] shadow-2xl shadow-black/60 backdrop-blur-2xl hardware-accel ${isMinimized ? "pointer-events-none" : ""} ${accentClass}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <h1 className="min-w-0 text-xs font-bold uppercase tracking-[0.18em] text-white/60">
            {isMissionSelected ? "Mission Control" : "Solar Explorer"}
          </h1>
          <div className="flex items-center gap-1.5">
            {/* Desktop/tablet minimize toggle */}
            <button
              onClick={() => setIsMinimized(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-zinc-900/50 text-zinc-300 transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
              title="Minimize panel"
              aria-label="Minimize panel"
            >
              <ChevronRight size={14} />
            </button>

            {/* Desktop/tablet width toggle */}
            <button
              onClick={toggleDesktopExpanded}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-zinc-900/50 text-zinc-300 transition-colors hover:border-blue-300/40 hover:bg-blue-500/15 hover:text-blue-100"
              title={isDesktopExpanded ? "Restore panel width" : "Expand panel"}
              aria-label={isDesktopExpanded ? "Restore panel width" : "Expand panel"}
            >
              {isDesktopExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>

            {/* Favorites Toggle */}
            <button
              onClick={openFavorites}
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-400/25 bg-red-500/10 text-zinc-300 transition-colors hover:border-red-300/50 hover:bg-red-500/20 hover:text-white"
              title="Favoritos"
            >
              <Heart className={`h-3.5 w-3.5 ${favorites.length > 0 ? 'text-red-500 fill-red-500' : 'text-zinc-400'}`} />
              {favorites.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white animate-in zoom-in-50 duration-300">
                  {favorites.length}
                </span>
              )}
            </button>

            {/* Mission Toggle */}
            <button
              onClick={handleMissionToggle}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
                isMissionSelected 
                  ? 'bg-blue-600 border-blue-400 text-white shadow-[0_0_10px_rgba(37,99,235,0.5)]' 
                  : 'bg-zinc-800/50 border-white/10 text-zinc-400 hover:bg-zinc-700/50 hover:border-white/20'
              }`}
              title={missionToggleDisabled ? "Mission data unavailable" : "Mission Context"}
              disabled={missionToggleDisabled}
            >
              <Rocket size={14} />
            </button>

            {/* Scale Toggle Button */}
            <button
              onClick={toggleViewMode}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-400/25 bg-blue-500/10 px-2 text-[10px] font-bold uppercase text-blue-300 transition-colors hover:border-blue-300/50 hover:bg-blue-500/20 hover:text-blue-100"
              title={
                viewMode === "didactic"
                  ? "Switch to realistic scale"
                  : "Switch to didactic scale"
              }
            >
              <span>{viewMode === "didactic" ? "📐" : "🔭"}</span>
              <span>{viewMode === "didactic" ? "Didactic" : "Realistic"}</span>
            </button>
            {isFallback && (
              <div className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-yellow-400/25 bg-yellow-500/10 px-2 text-[10px] font-bold uppercase text-yellow-300">
                <span>⚠️</span>
                <span>Offline</span>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 inspector-scrollbar">
          {hudContent}
        </div>

        {/* Decorative footer element */}
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-50" />
      </motion.div>
      <TimeTravelControls />
      <AstronomerModal
        isOpen={isAstronomerOpen}
        onClose={() => setIsAstronomerOpen(false)}
        planet={selectedPlanet}
      />
      <AuthModal />
      <FavoritesModal />
    </>
  );
}
