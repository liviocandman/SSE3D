import { create } from 'zustand';
import { createTimeSlice, type TimeSlice, type TimeAuthority } from './slices/timeSlice';
import { createSelectionSlice, type SelectionSlice } from './slices/selectionSlice';
import { createTrajectorySlice, type TrajectorySlice } from './slices/trajectorySlice';
import { createCameraSlice, type CameraSlice, type TravelTarget, type RenderOriginMode, type CameraNavMode } from './slices/cameraSlice';

// Re-export types for backward compatibility
export type { TimeAuthority, TravelTarget, RenderOriginMode, CameraNavMode };

export type SolarState = TimeSlice & SelectionSlice & TrajectorySlice & CameraSlice;

export const useSolarStore = create<SolarState>()((...a) => ({
  ...createTimeSlice(...a),
  ...createSelectionSlice(...a),
  ...createTrajectorySlice(...a),
  ...createCameraSlice(...a),
}));
