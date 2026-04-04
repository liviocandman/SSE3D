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
import { ChevronLeft, ChevronRight, Heart, Rocket } from "lucide-react";
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
  const missionVehicleId = missionState?.vehicleId ?? null;
  const isMissionSelected = !!missionVehicleId && selectedMissionTargetId === missionVehicleId;

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  // Always reopen the desktop drawer when a different planet or mission is selected.
  useEffect(() => {
    if (!isMobile && (selectedPlanet?.bodyId || selectedMissionTargetId)) {
      setIsMinimized(false);
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

  const hudContent = (
    <div className="space-y-6 pt-2">
      <div className="flex items-center justify-between">
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
      {isMissionSelected && missionState ? (
        <MissionInfo 
          missionState={missionState}
          missionHealth={missionHealth}
          missionEvents={missionEvents}
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
          className={`fixed bottom-0 left-0 right-0 glass-panel rounded-t-2xl z-[100] transition-all duration-500 ease-in-out hardware-accel ${accentClass}`}
          style={{ 
            height: isExpanded ? "55vh" : "max(64px, calc(64px + env(safe-area-inset-bottom)))",
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
            className="w-full h-8 flex items-center justify-center cursor-pointer"
            onClick={toggleExpand}
          >
            <div className="w-10 h-1 bg-white/30 rounded-full" />
          </div>

          {/* Collapsed preview */}
          {!isExpanded && (
            <div
              className="px-6 pb-4 flex items-center justify-between cursor-pointer"
              onClick={toggleExpand}
            >
              <span className="font-semibold text-lg tracking-tight">
                {isMissionSelected ? "Artemis II" : selectedPlanet ? selectedPlanet.englishName : "Solar Explorer"}
              </span>
              <span className="text-xs font-medium text-white/50 uppercase tracking-widest">
                Tap to explore
              </span>
            </div>
          )}

          {/* Expanded content */}
          <div
            className={`px-6 pb-8 overflow-y-auto h-[calc(55vh-32px)] transition-opacity duration-300 ${isExpanded ? "opacity-100" : "opacity-0 pointer-events-none"}`}
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
      <motion.div
        initial={false}
        animate={{
          x: isMinimized ? "calc(100% - 48px)" : 0,
          opacity: (selectedPlanet || isMissionSelected) ? 1 : 0.95,
        }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className={`fixed top-4 right-0 bottom-4 w-80 glass-panel rounded-l-2xl z-100 flex flex-col overflow-hidden hardware-accel border-l-2 ${accentClass}`}
      >
        {/* Left control tab for the desktop drawer */}
        <button
          onClick={() => setIsMinimized((prev) => !prev)}
          className="absolute left-0 top-1/2 z-[110] -translate-y-1/2 flex h-12 w-9 items-center justify-center rounded-r-xl border border-white/20 border-l-0 bg-black/55 backdrop-blur-xl text-white/80 transition-colors hover:bg-black/70 hover:text-white"
          title={isMinimized ? "Show panel" : "Hide panel"}
          aria-label={isMinimized ? "Show panel" : "Hide panel"}
        >
          {isMinimized ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>

        {/* Header */}
        <div className="p-6 pb-4 border-b border-white/10 flex items-center justify-between">
          <h1 className="text-sm font-bold text-white/70 tracking-[0.15em] uppercase">
            {isMissionSelected ? "Mission Control" : "Solar Explorer"}
          </h1>
          <div className="flex items-center gap-1.5">
            {/* Favorites Toggle */}
            <button
              onClick={openFavorites}
              className="relative p-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-md transition-colors group"
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
              className={`p-1.5 border rounded-md transition-all ${
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
              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-md text-[10px] font-bold text-blue-400 uppercase transition-colors"
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
              <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-md text-[10px] font-bold text-yellow-500 uppercase">
                <span>⚠️</span>
                <span>Offline</span>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 overflow-y-auto scrollbar-hide">
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
