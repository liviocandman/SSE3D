import { useEffect, useRef } from 'react';
import { useMissionStore } from '@/store/missionStore';
import { useSolarStore } from '@/store/solarStore';
import {
  fetchMissionState,
  fetchMissionTrajectory,
  fetchMissionEvents,
  fetchMissionHealth,
} from '@/services/missionClient';
import { MissionMode } from '@/lib/missionTypes';

export function useMissionData() {
  const missionMode = useMissionStore((state) => state.missionMode);
  const selectedMissionTargetId = useMissionStore((state) => state.selectedMissionTargetId);
  const setMissionState = useMissionStore((state) => state.setMissionState);
  const setMissionTrajectory = useMissionStore((state) => state.setMissionTrajectory);
  const setMissionEvents = useMissionStore((state) => state.setMissionEvents);
  const setMissionHealth = useMissionStore((state) => state.setMissionHealth);
  const setLiveTimestamp = useMissionStore((state) => state.setLiveTimestamp);

  const isLive = missionMode === MissionMode.LIVE;
  const controllersRef = useRef<Set<AbortController>>(new Set());

  useEffect(() => {
    if (!selectedMissionTargetId) {
      return;
    }

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
      try {
        let atParam: string | undefined = undefined;
        
        if (!isLive) {
          const currentTime = useSolarStore.getState().currentTime;
          // Drop milliseconds for cache-friendly requests in seconds precision
          const date = new Date(currentTime);
          atParam = date.toISOString().split('.')[0] + 'Z';
        }
        
        const data = await withAbortController((options) => fetchMissionState(atParam, options));
        
        if (isMounted) {
          setMissionState(data);
          if (isLive && data.sourceTimestamp) {
            setLiveTimestamp(data.sourceTimestamp);
            
            // Temporal bridge: Sync Solar system time to the live mission time
            const timestampDate = new Date(data.sourceTimestamp);
            if (!Number.isNaN(timestampDate.getTime())) {
              useSolarStore.getState().setCurrentTime(timestampDate);
            }
          } else if (!isLive) {
            setLiveTimestamp(null);
          }
        }
      } catch (err: any) {
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
      try {
        const data = await withAbortController((options) => fetchMissionTrajectory(options));
        if (isMounted) {
          setMissionTrajectory(data);
        }
      } catch (err: any) {
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
      try {
        const data = await withAbortController((options) => fetchMissionEvents(options));
        if (isMounted) {
          setMissionEvents(data);
        }
      } catch (err: any) {
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
      try {
        const data = await withAbortController((options) => fetchMissionHealth(options));
        if (isMounted) {
          setMissionHealth(data);
        }
      } catch (err: any) {
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

    return () => {
      isMounted = false;
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
      clearTimeout(stateTimeout);
      clearTimeout(trajectoryTimeout);
      clearTimeout(eventsTimeout);
      clearTimeout(healthTimeout);
    };
  }, [isLive, selectedMissionTargetId, setLiveTimestamp, setMissionEvents, setMissionHealth, setMissionState, setMissionTrajectory]);
}
