import { StateCreator } from 'zustand';
import type { PlanetSelection } from '@/lib/types';
import type { ViewMode } from '@/lib/scales';

export interface SelectionState {
  selectedPlanet: PlanetSelection | null;
  hoveredPlanetId: string | null;
  viewMode: ViewMode;
}

export interface SelectionActions {
  setSelectedPlanet: (planet: PlanetSelection | null) => void;
  setHoveredPlanetId: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
}

export type SelectionSlice = SelectionState & SelectionActions;

export const createSelectionSlice: StateCreator<SelectionSlice, [], [], SelectionSlice> = (set) => ({
  selectedPlanet: null,
  hoveredPlanetId: null,
  viewMode: 'didactic',

  setSelectedPlanet: (planet) => set(() => ({ selectedPlanet: planet })),
  setHoveredPlanetId: (id) => set(() => ({ hoveredPlanetId: id })),
  setViewMode: (mode) => set(() => ({ viewMode: mode })),
  toggleViewMode: () =>
    set((state) => ({ viewMode: state.viewMode === 'didactic' ? 'realistic' : 'didactic' })),
});
