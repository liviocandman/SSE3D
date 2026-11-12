import { useEffect } from 'react';
import { useSolarStore } from '@/store/solarStore';
import {
  getOrbitRecoveryAt, isAbortError, ORBIT_RECOVERY_COOLDOWN_MS,
} from '@/lib/trajectoryRequestErrors';
import { useTrajectoryClient } from './useTrajectoryClient';

export const FULL_ORBIT_RECOVERY_COOLDOWN_MS = ORBIT_RECOVERY_COOLDOWN_MS;
const MAX_TIMER_MS = 2_147_483_647;

/** Only a valid success without geometry is unavailable. Transport failures
 * retain their recovery deadline across scene remounts. */
export function useFullOrbits(ids: string[]) {
  const { requestFullOrbits } = useTrajectoryClient();
  const idsKey = Array.from(new Set(ids)).sort().join(',');
  useEffect(() => {
    const bodyIds = idsKey.split(',').filter(Boolean);
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: { controller: AbortController; ids: string[] } | undefined;

    function scheduleRecovery() {
      if (disposed) return;
      clearTimeout(timer);
      const state = useSolarStore.getState();
      const retryTimes = bodyIds.filter((id) => (state.fullOrbits[id]?.length ?? 0) < 2 &&
        state.fullOrbitStatus[id] === 'retryable_error').map((id) => state.fullOrbitRetryAt[id] ?? Date.now());
      if (retryTimes.length) {
        const delay = Math.max(0, Math.min(...retryTimes) - Date.now());
        timer = setTimeout(() => { void run(); }, Math.min(delay, MAX_TIMER_MS));
      }
    }

    async function run() {
      if (disposed) return;
      const state = useSolarStore.getState();
      const missingIds = bodyIds.filter((id) => (state.fullOrbits[id]?.length ?? 0) < 2 &&
        (!state.fullOrbitStatus[id] || state.fullOrbitStatus[id] === 'idle' ||
          (state.fullOrbitStatus[id] === 'retryable_error' && (state.fullOrbitRetryAt[id] ?? 0) <= Date.now())));
      if (!missingIds.length) { scheduleRecovery(); return; }

      const controller = new AbortController();
      active = { controller, ids: missingIds };
      state.setFullOrbitStatus(missingIds, 'loading');
      try {
        const data = await requestFullOrbits(missingIds, controller.signal);
        if (disposed || controller.signal.aborted) return;
        state.appendFullOrbits(data);
        const latest = useSolarStore.getState();
        state.setFullOrbitStatus(missingIds.filter((id) => (latest.fullOrbits[id]?.length ?? 0) >= 2), 'ready');
        state.setFullOrbitStatus(missingIds.filter((id) => (latest.fullOrbits[id]?.length ?? 0) < 2), 'unavailable');
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        const retryAt = getOrbitRecoveryAt(error);
        if (retryAt !== undefined) {
          state.setFullOrbitStatus(missingIds, 'retryable_error', retryAt);
        } else if (isAbortError(error)) {
          state.setFullOrbitStatus(missingIds, 'idle');
        } else {
          state.setFullOrbitStatus(missingIds, 'error');
        }
      } finally {
        active = undefined;
        scheduleRecovery();
      }
    }

    void run();
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (active) {
        active.controller.abort();
        const state = useSolarStore.getState();
        state.setFullOrbitStatus(active.ids.filter((id) => state.fullOrbitStatus[id] === 'loading'), 'idle');
      }
    };
  }, [idsKey, requestFullOrbits]);
}
