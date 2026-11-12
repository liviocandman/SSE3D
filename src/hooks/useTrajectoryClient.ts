import { useCallback, useEffect, useRef } from 'react';
import { buildTrajectoryRequestKey } from '@/lib/trajectoryPolicy';
import { useTrajectoryWorker } from '@/hooks/useTrajectoryWorker';
import {
  abortError, canRetryTrajectoryRequest, getTrajectoryRetryAt, isAbortError,
  parseRetryAfter, TrajectoryRequestDeferredError, TrajectoryRequestError,
} from '@/lib/trajectoryRequestErrors';
import type { EphemerisData } from '@/lib/types';

interface CacheEntry<T> { expiresAt: number; data: T }
interface InFlightRequest {
  controller: AbortController;
  promise: Promise<EphemerisData[]>;
  consumers: number;
  settled: boolean;
}
interface CoordinatedRequestOptions {
  requestKey: string;
  signal?: AbortSignal;
  cooldownMs: number;
  cacheTtlMs: number;
  execute: (signal: AbortSignal) => Promise<EphemerisData[]>;
}
interface TrajectoryBlockRequest {
  date: string; spanDays: number; ids: string[]; tier: string; signal?: AbortSignal;
}

export const TRAJECTORY_REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 300;
const TRAJECTORY_RESPONSE_CACHE_TTL_MS = 5_000;
const TRAJECTORY_FETCH_COOLDOWN_MS = 15_000;
const ORBIT_LINE_RESPONSE_CACHE_TTL_MS = 30_000;
const ORBIT_LINE_FETCH_COOLDOWN_MS = 30_000;
const MAX_LOCAL_CACHE_ENTRIES = 50;

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason ?? abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const timeout = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timeout); cleanup(); reject(signal.reason ?? abortError()); };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function pruneEntries<T>(entries: Map<string, T>, protectedKey?: string) {
  for (const key of entries.keys()) {
    if (entries.size <= MAX_LOCAL_CACHE_ENTRIES) break;
    if (key !== protectedKey) entries.delete(key);
  }
}

export function useTrajectoryClient() {
  const { fetchTrajectoryRaw } = useTrajectoryWorker();
  const inFlightRef = useRef(new Map<string, InFlightRequest>());
  const responseCacheRef = useRef(new Map<string, CacheEntry<EphemerisData[]>>());
  const retryAtRef = useRef(new Map<string, number>());

  useEffect(() => {
    const inFlight = inFlightRef.current;
    const cache = responseCacheRef.current;
    const cooldowns = retryAtRef.current;
    return () => {
      for (const request of inFlight.values()) request.controller.abort(abortError());
      inFlight.clear();
      cache.clear();
      cooldowns.clear();
    };
  }, []);

  const pruneLocalCacheEntries = useCallback((protectedKey?: string) => {
    const now = Date.now();
    for (const [key, value] of responseCacheRef.current) {
      if (value.expiresAt <= now) responseCacheRef.current.delete(key);
    }
    for (const [key, retryAt] of retryAtRef.current) {
      if (retryAt <= now) retryAtRef.current.delete(key);
    }
    pruneEntries(responseCacheRef.current, protectedKey);
    pruneEntries(retryAtRef.current, protectedKey);
  }, []);

  const runCoordinatedRequest = useCallback(async ({
    requestKey, signal, cooldownMs, cacheTtlMs, execute,
  }: CoordinatedRequestOptions): Promise<EphemerisData[]> => {
    if (signal?.aborted) throw abortError();
    pruneLocalCacheEntries(requestKey);
    const cached = responseCacheRef.current.get(requestKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    let entry = inFlightRef.current.get(requestKey);
    if (!entry) {
      const retryAt = retryAtRef.current.get(requestKey);
      if (retryAt !== undefined && Date.now() < retryAt) throw new TrajectoryRequestDeferredError(retryAt);

      const controller = new AbortController();
      entry = { controller, consumers: 0, settled: false, promise: Promise.resolve([]) };
      const currentEntry = entry;
      inFlightRef.current.set(requestKey, currentEntry);
      const deadline = Date.now() + TRAJECTORY_REQUEST_TIMEOUT_MS;
      const timeout = setTimeout(() => controller.abort(new DOMException('Trajectory request timed out', 'TimeoutError')), TRAJECTORY_REQUEST_TIMEOUT_MS);
      currentEntry.promise = (async () => {
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          controller.signal.throwIfAborted();
          try {
            const data = await withAbort(execute(controller.signal), controller.signal);
            controller.signal.throwIfAborted();
            responseCacheRef.current.set(requestKey, { expiresAt: Date.now() + cacheTtlMs, data });
            retryAtRef.current.set(requestKey, Date.now() + cooldownMs);
            return data;
          } catch (error) {
            const serverRetryAt = getTrajectoryRetryAt(error);
            if (serverRetryAt !== undefined) {
              // Preserve a server recovery window even if all subscribers cancel
              // while waiting. An abort without this hint still consumes no cooldown.
              retryAtRef.current.set(requestKey, Math.max(retryAtRef.current.get(requestKey) ?? 0, serverRetryAt));
            }
            if (controller.signal.aborted || !canRetryTrajectoryRequest(error) || attempt === MAX_ATTEMPTS - 1) throw error;
            const waitMs = Math.max(BASE_DELAY_MS * (attempt + 1), (serverRetryAt ?? 0) - Date.now());
            // Do not shorten Retry-After to fit the remaining budget. End this
            // cycle and let recovery start no earlier than the published retryAt.
            if (Date.now() + waitMs >= deadline) throw error;
            await delay(waitMs, controller.signal);
          }
        }
        return [];
      })().catch((error: unknown) => {
        // Failed jobs also enter cooldown, preventing each animation tick from
        // starting another complete retry budget during an outage.
        if (isAbortError(error)) throw error;
        const retryAt = Math.max(Date.now() + cooldownMs, getTrajectoryRetryAt(error) ?? 0, retryAtRef.current.get(requestKey) ?? 0);
        retryAtRef.current.set(requestKey, retryAt);
        // Keep TimeoutError/SyntaxError/HTTP classification intact for consumers.
        const failure = typeof error === 'object' && error !== null && 'name' in error && 'message' in error
          ? error : new Error('Trajectory request failed');
        throw Object.assign(failure, { retryAt });
      }).finally(() => {
        clearTimeout(timeout);
        currentEntry.settled = true;
        if (inFlightRef.current.get(requestKey) === currentEntry) inFlightRef.current.delete(requestKey);
        pruneLocalCacheEntries(requestKey);
      });
    }

    const subscribedEntry = entry;
    subscribedEntry.consumers++;
    try {
      return await (signal ? withAbort(subscribedEntry.promise, signal) : subscribedEntry.promise);
    } finally {
      subscribedEntry.consumers--;
      if (subscribedEntry.consumers === 0 && !subscribedEntry.settled) {
        subscribedEntry.controller.abort(abortError());
        if (inFlightRef.current.get(requestKey) === subscribedEntry) inFlightRef.current.delete(requestKey);
      }
    }
  }, [pruneLocalCacheEntries]);

  const requestTrajectoryBlock = useCallback(async ({ date, spanDays, ids, tier, signal }: TrajectoryBlockRequest) => {
    // Quality affects drawing only; scientific samples and fetches are shared.
    return runCoordinatedRequest({
      requestKey: buildTrajectoryRequestKey(date, spanDays, ids), signal,
      cooldownMs: TRAJECTORY_FETCH_COOLDOWN_MS, cacheTtlMs: TRAJECTORY_RESPONSE_CACHE_TTL_MS,
      execute: (requestSignal) => fetchTrajectoryRaw(date, spanDays, ids, tier, requestSignal),
    });
  }, [fetchTrajectoryRaw, runCoordinatedRequest]);

  const requestOrbits = useCallback(async (ids: string[], orbitLineOnly: boolean, signal?: AbortSignal) => {
    const normalizedIds = Array.from(new Set(ids)).sort();
    return runCoordinatedRequest({
      requestKey: `${orbitLineOnly ? 'orbit-lines' : 'full-orbits'}|${normalizedIds.join(',')}`, signal,
      cooldownMs: ORBIT_LINE_FETCH_COOLDOWN_MS, cacheTtlMs: ORBIT_LINE_RESPONSE_CACHE_TTL_MS,
      execute: async (requestSignal) => {
        const params = new URLSearchParams({ ids: normalizedIds.join(','), fullOrbit: 'true' });
        if (orbitLineOnly) { params.set('orbitReady', 'true'); params.set('orbitLineOnly', 'true'); }
        const response = await fetch(`/api/ephemeris?${params}`, { signal: requestSignal });
        if (!response.ok) throw new TrajectoryRequestError(
          `Orbit request failed with status ${response.status}`,
          response.status,
          parseRetryAfter(response.headers?.get('Retry-After') ?? null),
        );
        const payload: { data?: EphemerisData[] } = await response.json();
        if (!Array.isArray(payload.data)) throw new SyntaxError('Invalid orbit response: missing data array');
        return payload.data;
      },
    });
  }, [runCoordinatedRequest]);

  const requestOrbitLines = useCallback((ids: string[], signal?: AbortSignal) => requestOrbits(ids, true, signal), [requestOrbits]);
  const requestFullOrbits = useCallback((ids: string[], signal?: AbortSignal) => requestOrbits(ids, false, signal), [requestOrbits]);
  return { requestTrajectoryBlock, requestOrbitLines, requestFullOrbits };
}
