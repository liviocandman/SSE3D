import { StateCreator } from 'zustand';

export interface TravelTarget {
  x: number;
  y: number;
  z: number;
}

export type RenderOriginMode = 'global' | 'selected_body' | 'mission_vehicle' | 'custom';

export type CameraNavMode = 'idle' | 'travel' | 'follow';

export interface CameraState {
  travelTarget: TravelTarget | null;
  travelTargetRadius?: number;

  // Camera-relative rendering (V1 & V2 Core)
  renderOrigin: { x: number; y: number; z: number };
  renderOriginMode: RenderOriginMode;

  // Navigation V2 (Origin-Only Model)
  cameraNavMode: CameraNavMode;
  originStartKm: { x: number; y: number; z: number };
  originTargetKm: { x: number; y: number; z: number };
  travelStartMs: number;
  travelDurationMs: number;
  followTargetId: string | null;
  followLeadTimeMs: number;
}

export interface CameraActions {
  setTravelTarget: (target: TravelTarget | null, radius?: number) => void;
  resetTravel: () => void;
  setRenderOrigin: (origin: { x: number; y: number; z: number }, mode?: RenderOriginMode) => void;
  resetRenderOrigin: () => void;
  startOriginTravel: (
    targetKm: { x: number; y: number; z: number },
    durationMs: number,
    nowMs: number,
    followTargetId?: string | null
  ) => void;
  setFollowTarget: (targetId: string | null, leadTimeMs?: number) => void;
  setOriginTarget: (targetKm: { x: number; y: number; z: number }) => void;
  stopOriginNavigation: () => void;
}

export type CameraSlice = CameraState & CameraActions;

export const createCameraSlice: StateCreator<CameraSlice, [], [], CameraSlice> = (set) => ({
  travelTarget: null,
  travelTargetRadius: undefined,
  renderOrigin: { x: 0, y: 0, z: 0 },
  renderOriginMode: 'global',

  cameraNavMode: 'idle',
  originStartKm: { x: 0, y: 0, z: 0 },
  originTargetKm: { x: 0, y: 0, z: 0 },
  travelStartMs: 0,
  travelDurationMs: 0,
  followTargetId: null,
  followLeadTimeMs: 0,

  setTravelTarget: (target, radius) =>
    set(() => ({ travelTarget: target, travelTargetRadius: radius })),
  resetTravel: () => set(() => ({ travelTarget: null, travelTargetRadius: undefined })),
  setRenderOrigin: (origin, mode = 'custom') =>
    set(() => ({ renderOrigin: origin, renderOriginMode: mode })),
  resetRenderOrigin: () =>
    set(() => ({ renderOrigin: { x: 0, y: 0, z: 0 }, renderOriginMode: 'global' })),

  startOriginTravel: (targetKm, durationMs, nowMs, followTargetId = null) => set((state) => ({
    cameraNavMode: 'travel',
    originStartKm: { ...state.renderOrigin },
    originTargetKm: targetKm,
    travelStartMs: nowMs,
    travelDurationMs: durationMs,
    followTargetId
  })),
  setFollowTarget: (targetId, leadTimeMs = 0) => set({
    cameraNavMode: 'follow',
    followTargetId: targetId,
    followLeadTimeMs: leadTimeMs
  }),
  setOriginTarget: (targetKm) => set({
    originTargetKm: targetKm
  }),
  stopOriginNavigation: () => set({
    cameraNavMode: 'idle',
    followTargetId: null
  }),
});
