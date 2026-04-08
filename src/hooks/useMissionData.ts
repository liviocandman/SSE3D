import { useCallback, useEffect, useRef } from 'react';
import { useMissionStore } from '@/store/missionStore';
import { useSolarStore } from '@/store/solarStore';
import {
  fetchMissionState,
  fetchMissionTrajectory,
  fetchMissionEvents,
  fetchMissionHealth,
} from '@/services/missionClient';
import { MissionMode } from '@/lib/missionTypes';
import { temporalMetrics } from '@/lib/time/metrics';

export function useMissionData() {
  const missionMode = useMissionStore((state) => state.missionMode);
  const setMissionState = useMissionStore((state) => state.setMissionState);
  const setMissionTrajectory = useMissionStore((state) => state.setMissionTrajectory);
  const setMissionEvents = useMissionStore((state) => state.setMissionEvents);
  const setMissionHealth = useMissionStore((state) => state.setMissionHealth);
  const setLiveTimestamp = useMissionStore((state) => state.setLiveTimestamp);

  const isLive = missionMode === MissionMode.LIVE;
  const controllersRef = useRef<Set<AbortController>>(new Set());
  const stateRequestIdRef = useRef(0);
  const trajectoryRequestIdRef = useRef(0);
  const eventsRequestIdRef = useRef(0);
  const healthRequestIdRef = useRef(0);

  const getReplayTimestampParam = useCallback((): string | undefined => {
    if (isLive) {
      return undefined;
    }

    const currentTime = useSolarStore.getState().currentTime;
    const date = new Date(currentTime);
    return date.toISOString().split('.')[0] + 'Z';
  }, [isLive]);

  const shouldApplyReplayResponse = useCallback(
    (requestMode: MissionMode, requestAt: string | undefined, requestId: number, latestRequestId: number) => {
      if (requestId !== latestRequestId) {
        return false;
      }

      const missionStore = useMissionStore.getState();
      if (missionStore.missionMode !== requestMode) {
        return false;
      }

      if (requestMode !== MissionMode.REPLAY) {
        return true;
      }

      const solarStore = useSolarStore.getState();
      if (solarStore.isPlaying) {
        return true;
      }

      // Some endpoints (e.g., health) are not timestamp-addressable.
      // In paused replay, accept the response if mode/request identity still matches.
      if (requestAt === undefined) {
        return true;
      }

      return requestAt === getReplayTimestampParam();
    },
    [getReplayTimestampParam]
  );

  useEffect(() => {
    let stateTimeout: NodeJS.Timeout;
    let trajectoryTimeout: NodeJS.Timeout;
    let eventsTimeout: NodeJS.Timeout;
    let healthTimeout: NodeJS.Timeout;
    
    let isMounted = true;

    const withAbortController = async <T,>(
      request: (options: { signal: AbortSignal }) => Promise<T>
    ): Promise<T> => {
      const controller = new AbortController();
      controllersRef.current.add(controller);

      try {
        return await request({ signal: controller.signal });
      } finally {
        controllersRef.current.delete(controller);
      }
    };

    const fetchState = async () => {
      if (!isMounted) return;
      
      const currentMode = useMissionStore.getState().missionMode;
      const requestId = ++stateRequestIdRef.current;
      const atParam = getReplayTimestampParam();
      
      try {
        const data = await withAbortController((options) => fetchMissionState(atParam, options));
        
        if (isMounted) {
          if (!shouldApplyReplayResponse(currentMode, atParam, requestId, stateRequestIdRef.current)) {
            console.debug('[MissionData] Dropping stale mission state response');
            temporalMetrics.recordDroppedResponse();
            return;
          }
          
          setMissionState(data);
          if (isLive && data.sourceTimestamp) {
            setLiveTimestamp(data.sourceTimestamp);
            
            // Temporal bridge: Sync Solar system time to the live mission time
            const timestampDate = new Date(data.sourceTimestamp);
            if (!Number.isNaN(timestampDate.getTime())) {
              const solarStore = useSolarStore.getState();
              
              // Only bridge if we are in LIVE mode
              if (solarStore.timeAuthority !== 'mission_live') {
                console.info('[MissionData] Bridging authority to mission_live');
                solarStore.setTimeAuthority('mission_live');
                temporalMetrics.recordAuthoritySwitch();
              }
              
              solarStore.setIsPlaying(false);
              solarStore.setCurrentTime(timestampDate);
            }
          } else if (!isLive) {
            // Replay mode: ensure authority is 'user'
            const solarStore = useSolarStore.getState();
            if (solarStore.timeAuthority !== 'user') {
              console.info('[MissionData] Returning authority to user');
              solarStore.setTimeAuthority('user');
              temporalMetrics.recordAuthoritySwitch();
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to fetch mission state', err);
      } finally {
        if (isMounted) {
          const delay = isLive ? 20000 : 2000;
          stateTimeout = setTimeout(fetchState, delay);
        }
      }
    };

    const fetchTrajectory = async () => {
      if (!isMounted) return;
      const currentMode = useMissionStore.getState().missionMode;
      const requestId = ++trajectoryRequestIdRef.current;
      const atParam = getReplayTimestampParam();
      try {
        const data = await withAbortController((options) => fetchMissionTrajectory(atParam, options));
        if (isMounted && shouldApplyReplayResponse(currentMode, atParam, requestId, trajectoryRequestIdRef.current)) {
          setMissionTrajectory(data);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to fetch mission trajectory', err);
      } finally {
        if (isMounted) {
          trajectoryTimeout = setTimeout(fetchTrajectory, 30000);
        }
      }
    };

    const fetchEvents = async () => {
      if (!isMounted) return;
      const currentMode = useMissionStore.getState().missionMode;
      const requestId = ++eventsRequestIdRef.current;
      const atParam = getReplayTimestampParam();
      try {
        const data = await withAbortController((options) => fetchMissionEvents(atParam, options));
        if (isMounted && shouldApplyReplayResponse(currentMode, atParam, requestId, eventsRequestIdRef.current)) {
          setMissionEvents(data);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to fetch mission events', err);
      } finally {
        if (isMounted) {
          eventsTimeout = setTimeout(fetchEvents, 300000); // 5 minutes
        }
      }
    };

    const fetchHealth = async () => {
      if (!isMounted) return;
      const currentMode = useMissionStore.getState().missionMode;
      const requestId = ++healthRequestIdRef.current;
      try {
        const data = await withAbortController((options) => fetchMissionHealth(options));
        if (isMounted && shouldApplyReplayResponse(currentMode, undefined, requestId, healthRequestIdRef.current)) {
          setMissionHealth(data);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to fetch mission health', err);
      } finally {
        if (isMounted) {
          healthTimeout = setTimeout(fetchHealth, 20000);
        }
      }
    };

    fetchState();
    fetchTrajectory();
    fetchEvents();
    fetchHealth();

    const controllers = controllersRef.current;

    return () => {
      isMounted = false;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      clearTimeout(stateTimeout);
      clearTimeout(trajectoryTimeout);
      clearTimeout(eventsTimeout);
      clearTimeout(healthTimeout);
    };
  }, [getReplayTimestampParam, isLive, setLiveTimestamp, setMissionEvents, setMissionHealth, setMissionState, setMissionTrajectory, shouldApplyReplayResponse]);
}
