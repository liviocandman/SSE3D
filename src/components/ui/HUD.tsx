"use client";

import { useState, useEffect } from "react";
import { PlanetInfo } from "./PlanetInfo";
import { DateSelector } from "./DateSelector";
import { AstronomerModal } from "./AstronomerModal";
import { useSolarStore } from "@/store/solarStore";

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
  onDateChange,
  onRefresh,
  isFallback = false,
}: HUDProps) {
  const isMobile = useIsMobile();
  const selectedPlanet = useSolarStore((state) => state.selectedPlanet);
  const currentDate = useSolarStore((state) => state.currentDate);
  const viewMode = useSolarStore((state) => state.viewMode);
  const toggleViewMode = useSolarStore((state) => state.toggleViewMode);
  const [isAstronomerOpen, setIsAstronomerOpen] = useState(false);
  // Start expanded if planet is already selected, otherwise collapsed
  const [isExpanded, setIsExpanded] = useState(() => !!selectedPlanet);

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const accentClass = selectedPlanet
    ? getPlanetAccentClass(selectedPlanet.bodyId)
    : "border-white/10 shadow-black/40";

  if (isMobile) {
    return (
      <>
        <div
          className={`fixed bottom-0 left-0 right-0 glass-panel rounded-t-2xl z-100 transition-all duration-500 ease-in-out hardware-accel ${accentClass}`}
          /* mobileSheetStyle */
          style={{ height: isExpanded ? "55vh" : "64px" }}
        >
          {/* Drag handle area */}
          <div
            className="w-full h-8 flex items-center justify-center cursor-pointer"
            /* dragHandleAreaStyle */
            onClick={toggleExpand}
          >
            <div className="w-10 h-1 bg-white/30 rounded-full" />
            {/* dragHandleStyle */}
          </div>

          {/* Collapsed preview */}
          {!isExpanded && (
            <div
              className="px-6 pb-4 flex items-center justify-between cursor-pointer"
              /* mobilePreviewStyle */
              onClick={toggleExpand}
            >
              <span className="font-semibold text-lg tracking-tight">
                {selectedPlanet ? selectedPlanet.englishName : "Solar Explorer"}
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
            {/* expandedContentStyle */}
            <div className="space-y-6 pt-2">
              <div className="flex items-center justify-between">
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
                {isFallback && (
                  <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-md text-[10px] font-bold text-yellow-500 uppercase">
                    <span>⚠️</span>
                    <span>Offline</span>
                  </div>
                )}
              </div>

              {/* Date Selector */}
              <DateSelector
                currentDate={currentDate}
                onDateChange={onDateChange}
                onRefresh={onRefresh}
              />

              <div className="h-px bg-white/10" />

              {/* Planet Info */}
              <PlanetInfo
                planet={selectedPlanet}
                earthPosition={earthPosition}
                onAskAstronomer={() => setIsAstronomerOpen(true)}
              />
            </div>
          </div>
        </div>
        <AstronomerModal
          isOpen={isAstronomerOpen}
          onClose={() => setIsAstronomerOpen(false)}
          planet={selectedPlanet}
          currentDate={currentDate}
        />
      </>
    );
  }

  // Desktop sidebar
  return (
    <>
      <div
        className={`fixed top-4 right-4 bottom-4 w-80 glass-panel rounded-2xl z-100 flex flex-col overflow-hidden transition-all duration-700 hardware-accel border-l-2 ${accentClass} ${selectedPlanet ? "translate-x-0 opacity-100" : "translate-x-12 opacity-90"}`}
      >
        {/* sidebarStyle */}
        {/* Header */}
        <div className="p-6 pb-4 border-b border-white/10 flex items-center justify-between">
          <h1 className="text-sm font-bold text-white/70 tracking-[0.15em] uppercase">
            Solar Explorer
          </h1>
          <div className="flex items-center gap-2">
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
          {/* sidebarContentStyle */}
          <div className="space-y-8">
            {/* Date Selector */}
            <DateSelector
              currentDate={currentDate}
              onDateChange={onDateChange}
              onRefresh={onRefresh}
            />

            <div className="h-px bg-white/5" />

            {/* Planet Info */}
            <PlanetInfo
              planet={selectedPlanet}
              earthPosition={earthPosition}
              onAskAstronomer={() => setIsAstronomerOpen(true)}
            />
          </div>
        </div>

        {/* Decorative footer element */}
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-50" />
      </div>
      <AstronomerModal
        isOpen={isAstronomerOpen}
        onClose={() => setIsAstronomerOpen(false)}
        planet={selectedPlanet}
        currentDate={currentDate}
      />
    </>
  );
}
