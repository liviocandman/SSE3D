import { StateCreator } from 'zustand';
import type { SelectedPlanet } from '@/lib/types';
import type { ViewMode } from '@/lib/scales';

export interface SelectionState {
  selectedPlanet: SelectedPlanet | null;
  hoveredPlanetId: string | null;
  viewMode: ViewMode;
}

export interface SelectionActions {
  setSelectedPlanet: (planet: SelectedPlanet | null) => void;
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
