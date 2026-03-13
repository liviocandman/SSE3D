'use client';

import { create } from 'zustand';
import type { SelectedPlanet } from '@/lib/types';
import type { ViewMode } from '@/lib/scales';

interface TravelTarget {
  x: number;
  y: number;
  z: number;
}

interface SolarState {
  currentDate: string;
  selectedPlanet: SelectedPlanet | null;
  viewMode: ViewMode;
  travelTarget: TravelTarget | null;
  travelTargetRadius?: number;
  setCurrentDate: (date: string) => void;
  setSelectedPlanet: (planet: SelectedPlanet | null) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  setTravelTarget: (target: TravelTarget | null, radius?: number) => void;
  resetTravel: () => void;
}

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

export const useSolarStore = create<SolarState>((set) => ({
  currentDate: getTodayString(),
  selectedPlanet: null,
  viewMode: 'didactic',
  travelTarget: null,
  travelTargetRadius: undefined,
  setCurrentDate: (date) =>
    set(() => ({
      currentDate: date,
      selectedPlanet: null,
      travelTarget: null,
      travelTargetRadius: undefined,
    })),
  setSelectedPlanet: (planet) => set(() => ({ selectedPlanet: planet })),
  setViewMode: (mode) => set(() => ({ viewMode: mode })),
  toggleViewMode: () =>
    set((state) => ({ viewMode: state.viewMode === 'didactic' ? 'realistic' : 'didactic' })),
  setTravelTarget: (target, radius) =>
    set(() => ({ travelTarget: target, travelTargetRadius: radius })),
  resetTravel: () => set(() => ({ travelTarget: null, travelTargetRadius: undefined })),
}));
