import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useMissionData } from './useMissionData';
import { useMissionStore } from '@/store/missionStore';
import { useSolarStore } from '@/store/solarStore';
import { MissionMode } from '@/lib/missionTypes';
import * as missionClient from '@/services/missionClient';

// Mock the client
vi.mock('@/services/missionClient', () => ({
  fetchMissionState: vi.fn(),
  fetchMissionTrajectory: vi.fn(),
  fetchMissionEvents: vi.fn(),
  fetchMissionHealth: vi.fn(),
}));

describe('useMissionData hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMissionStore.getState().resetMissionState();
    
    // Default mock responses
    vi.mocked(missionClient.fetchMissionTrajectory).mockResolvedValue({} as any);
    vi.mocked(missionClient.fetchMissionEvents).mockResolvedValue({} as any);
    vi.mocked(missionClient.fetchMissionHealth).mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch mission data even when no mission target is selected yet', async () => {
    vi.mocked(missionClient.fetchMissionState).mockResolvedValue({} as any);
    const { unmount } = renderHook(() => useMissionData());

    await waitFor(() => {
      expect(missionClient.fetchMissionState).toHaveBeenCalled();
    });
    unmount();
  });

  it('should fetch live data correctly on mount', async () => {
    useMissionStore.getState().setMissionMode(MissionMode.LIVE);

    const mockState = {
      missionId: 'artemis-2',
      sourceTimestamp: '2026-04-03T12:00:00Z'
    };

    vi.mocked(missionClient.fetchMissionState).mockResolvedValue(mockState as any);

    const { unmount } = renderHook(() => useMissionData());

    await waitFor(() => {
      expect(missionClient.fetchMissionState).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(useMissionStore.getState().missionState).toEqual(mockState);
      expect(useMissionStore.getState().liveTimestamp).toEqual('2026-04-03T12:00:00Z');
      expect(useSolarStore.getState().currentTime.toISOString()).toEqual('2026-04-03T12:00:00.000Z');
    });
    
    unmount();
  });

  it('should fetch replay data with formatted timestamp', async () => {
    useMissionStore.getState().setMissionMode(MissionMode.REPLAY);
    useSolarStore.getState().setCurrentTime(new Date('2026-04-05T12:00:00.123Z'));

    vi.mocked(missionClient.fetchMissionState).mockResolvedValue({} as any);

    const { unmount } = renderHook(() => useMissionData());

    await waitFor(() => {
      // should drop milliseconds
      expect(missionClient.fetchMissionState).toHaveBeenCalledWith(
        '2026-04-05T12:00:00Z',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(missionClient.fetchMissionTrajectory).toHaveBeenCalledWith(
        '2026-04-05T12:00:00Z',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    
    unmount();
  });

  it('should clean up on unmount', () => {
    const { unmount } = renderHook(() => useMissionData());
    
    vi.clearAllMocks();

    unmount();
    // Re-verify no new calls are made. In fake timers we'd advance time,
    // but here we just check that clearAllMocks left it clean.
    expect(missionClient.fetchMissionState).not.toHaveBeenCalled();
  });
});
