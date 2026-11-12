import { useEffect } from 'react';
import { useSolarStore } from '@/store/solarStore';
import { buildMoonOrbitPrefetchDemands } from '@/lib/trajectoryAvailabilityPolicy';
import { getOrbitRecoveryAt, isAbortError } from '@/lib/trajectoryRequestErrors';
import type { EphemerisData } from '@/lib/types';

const PREFETCH_DEBOUNCE_MS = 250;
const MAX_TIMER_MS = 2_147_483_647;
const MIN_ORBIT_LINE_POINTS = 2;
type OrbitLineRequest = (ids: string[], signal?: AbortSignal) => Promise<EphemerisData[]>;

/** Context owns scheduling; the shared request client owns transport retries. */
export function useMoonOrbitLines(parentIds: string[], requestOrbitLines: OrbitLineRequest) {
  const parentsKey = Array.from(new Set(parentIds)).sort().join(',');
  useEffect(() => {
    const contextParents = parentsKey.split(',').filter(Boolean);
    const active = new Map<string, { ids: string[]; controller: AbortController }>();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function missingDemands() {
      return buildMoonOrbitPrefetchDemands({
        parentIds: contextParents,
        orbitLines: useSolarStore.getState().orbitLines,
        minOrbitLinePoints: MIN_ORBIT_LINE_POINTS,
      });
    }

    function scheduleRecovery() {
      if (disposed) return;
      clearTimeout(timer);
      const state = useSolarStore.getState();
      const retryTimes = missingDemands().filter((demand) => !active.has(demand.parentId))
        .flatMap((demand) => demand.ids)
        .filter((id) => state.orbitLineStatus[id] === 'retryable_error')
        .map((id) => state.orbitLineRetryAt[id] ?? Date.now());
      if (retryTimes.length) {
        const delay = Math.max(0, Math.min(...retryTimes) - Date.now());
        timer = setTimeout(run, Math.min(delay, MAX_TIMER_MS));
      }
    }

    async function fetchLines(parentId: string, ids: string[]) {
      const controller = new AbortController();
      active.set(parentId, { ids, controller });
      const state = useSolarStore.getState();
      state.setOrbitLineStatus(ids, 'loading');
      try {
        const data = await requestOrbitLines(ids, controller.signal);
        if (disposed || controller.signal.aborted) return;
        state.appendFullOrbits(data);
        const latest = useSolarStore.getState();
        const ready = (id: string) => (latest.orbitLines[id]?.points.length ?? 0) >= MIN_ORBIT_LINE_POINTS;
        state.setOrbitLineStatus(ids.filter(ready), 'ready');
        state.setOrbitLineStatus(ids.filter((id) => !ready(id)), 'unavailable');
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        const retryAt = getOrbitRecoveryAt(error);
        if (retryAt !== undefined) state.setOrbitLineStatus(ids, 'retryable_error', retryAt);
        else state.setOrbitLineStatus(ids, isAbortError(error) ? 'idle' : 'error');
      } finally {
        active.delete(parentId);
        scheduleRecovery();
      }
    }

    function run() {
      if (disposed) return;
      const state = useSolarStore.getState();
      for (const demand of missingDemands()) {
        if (active.has(demand.parentId)) continue;
        const ids = demand.ids.filter((id) => !state.orbitLineStatus[id] || state.orbitLineStatus[id] === 'idle'
          || (state.orbitLineStatus[id] === 'retryable_error' && (state.orbitLineRetryAt[id] ?? 0) <= Date.now()));
        if (ids.length) void fetchLines(demand.parentId, ids);
      }
      scheduleRecovery();
    }

    if (contextParents.length) timer = setTimeout(run, PREFETCH_DEBOUNCE_MS);
    return () => {
      disposed = true;
      clearTimeout(timer);
      const state = useSolarStore.getState();
      for (const request of active.values()) {
        request.controller.abort();
        state.setOrbitLineStatus(request.ids.filter((id) => state.orbitLineStatus[id] === 'loading'), 'idle');
      }
    };
  }, [parentsKey, requestOrbitLines]);
}
