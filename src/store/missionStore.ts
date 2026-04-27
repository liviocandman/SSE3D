import { create } from 'zustand';
import {
  MissionState,
  MissionTrajectory,
  MissionEventsResponse,
  MissionHealth,
  MissionMode
} from '@/lib/missionTypes';

interface MissionStoreState {
  missionMode: MissionMode;
  isLive: boolean;
  autoFocusEvents: boolean;
  estimatedAttitudeEnabled: boolean;
  selectedMissionTargetId: string | null;
  missionState: MissionState | null;
  missionTrajectory: MissionTrajectory | null;
  missionEvents: MissionEventsResponse | null;
  missionHealth: MissionHealth | null;
  liveTimestamp: string | null;
}

interface MissionStoreActions {
  setMissionMode: (mode: MissionMode) => void;
  setIsLive: (isLive: boolean) => void;
  setSelectedMissionTargetId: (id: string | null) => void;
  setMissionState: (state: MissionState | null) => void;
  setMissionTrajectory: (trajectory: MissionTrajectory | null) => void;
  setMissionEvents: (events: MissionEventsResponse | null) => void;
  setMissionHealth: (health: MissionHealth | null) => void;
  setLiveTimestamp: (timestamp: string | null) => void;
  setAutoFocusEvents: (enabled: boolean) => void;
  setEstimatedAttitudeEnabled: (enabled: boolean) => void;
  resetMissionState: () => void;
}

export const useMissionStore = create<MissionStoreState & MissionStoreActions>((set) => ({
  missionMode: MissionMode.LIVE,
  isLive: true,
  autoFocusEvents: false, // Default conservative as per Story 8.1.1
  estimatedAttitudeEnabled: true,
  selectedMissionTargetId: null,
  missionState: null,
  missionTrajectory: null,
  missionEvents: null,
  missionHealth: null,
  liveTimestamp: null,

  setMissionMode: (mode) => set({
    missionMode: mode,
    isLive: mode === MissionMode.LIVE,
  }),
  setIsLive: (isLive) => set({
    isLive,
    missionMode: isLive ? MissionMode.LIVE : MissionMode.REPLAY,
  }),
  setSelectedMissionTargetId: (id) => set({ selectedMissionTargetId: id }),
  setMissionState: (state) => set(() => ({
    missionState: state,
  })),
  setMissionTrajectory: (trajectory) => set({ missionTrajectory: trajectory }),
  setMissionEvents: (events) => set({ missionEvents: events }),
  setMissionHealth: (health) => set({ missionHealth: health }),
  setLiveTimestamp: (timestamp) => set({ liveTimestamp: timestamp }),
  setAutoFocusEvents: (autoFocusEvents) => set({ autoFocusEvents }),
  setEstimatedAttitudeEnabled: (estimatedAttitudeEnabled) => set({ estimatedAttitudeEnabled }),
  resetMissionState: () => set({
    missionMode: MissionMode.LIVE,
    isLive: true,
    autoFocusEvents: false,
    estimatedAttitudeEnabled: true,
    selectedMissionTargetId: null,
    missionState: null,
    missionTrajectory: null,
    missionEvents: null,
    missionHealth: null,
    liveTimestamp: null,
  }),
}));
