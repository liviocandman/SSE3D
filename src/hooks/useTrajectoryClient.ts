import { useCallback, useRef } from "react";
import { buildTrajectoryRequestKey } from "@/lib/trajectoryPolicy";
import { useTrajectoryWorker } from "@/hooks/useTrajectoryWorker";
import type { EphemerisData } from "@/lib/types";

interface CacheEntry<T> {
  expiresAt: number;
  data: T;
}

interface CoordinatedRequestOptions<T> {
  requestKey: string;
  signal?: AbortSignal;
  cooldownMs: number;
  cacheTtlMs: number;
  retries?: number;
  execute: (signal?: AbortSignal) => Promise<T>;
}

interface TrajectoryBlockRequest {
  date: string;
  spanDays: number;
  ids: string[];
  tier: string;
  signal?: AbortSignal;
}

const DEFAULT_RETRIES = 2;
const BASE_DELAY_MS = 300;
const TRAJECTORY_RESPONSE_CACHE_TTL_MS = 5_000;
const TRAJECTORY_FETCH_COOLDOWN_MS = 15_000;
const ORBIT_LINE_RESPONSE_CACHE_TTL_MS = 30_000;
const ORBIT_LINE_FETCH_COOLDOWN_MS = 30_000;
const MAX_LOCAL_CACHE_ENTRIES = 50;
const MAX_REQUEST_COOLDOWN_MS = Math.max(
  TRAJECTORY_FETCH_COOLDOWN_MS,
  ORBIT_LINE_FETCH_COOLDOWN_MS,
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getBackoffDelay(attempt: number): number {
  return BASE_DELAY_MS * (attempt + 1);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.message === "AbortError";
}

function pruneOldestEntries<T>(
  entries: Map<string, T>,
  maxEntries: number,
  protectedKey?: string,
): void {
  if (entries.size <= maxEntries) {
    return;
  }

  for (const key of entries.keys()) {
    if (entries.size <= maxEntries) {
      return;
    }
    if (key === protectedKey) {
      continue;
    }
    entries.delete(key);
  }
}

function attachAbortToPromise<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;

  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("AbortError"));
      return;
    }

    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(new Error("AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function useTrajectoryClient() {
  const { fetchTrajectoryRaw } = useTrajectoryWorker();
  const inFlightRef = useRef<Map<string, Promise<EphemerisData[]>>>(new Map());
  const responseCacheRef = useRef<Map<string, CacheEntry<EphemerisData[]>>>(new Map());
  const lastRequestAtRef = useRef<Map<string, number>>(new Map());

  const pruneLocalCacheEntries = useCallback((protectedKey?: string) => {
    const now = Date.now();
    for (const [key, value] of responseCacheRef.current) {
      if (value.expiresAt <= now) {
        responseCacheRef.current.delete(key);
      }
    }
    for (const [key, lastRequestAt] of lastRequestAtRef.current) {
      if (now - lastRequestAt >= MAX_REQUEST_COOLDOWN_MS) {
        lastRequestAtRef.current.delete(key);
      }
    }
    pruneOldestEntries(responseCacheRef.current, MAX_LOCAL_CACHE_ENTRIES, protectedKey);
    pruneOldestEntries(lastRequestAtRef.current, MAX_LOCAL_CACHE_ENTRIES, protectedKey);
  }, []);

  const runCoordinatedRequest = useCallback(
    async ({
      requestKey,
      signal,
      cooldownMs,
      cacheTtlMs,
      retries = DEFAULT_RETRIES,
      execute,
    }: CoordinatedRequestOptions<EphemerisData[]>): Promise<EphemerisData[]> => {
      if (signal?.aborted) {
        throw new Error("AbortError");
      }

      pruneLocalCacheEntries(requestKey);

      const cached = responseCacheRef.current.get(requestKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
      }

      const inFlight = inFlightRef.current.get(requestKey);
      if (inFlight) {
        return attachAbortToPromise(inFlight, signal);
      }

      const now = Date.now();
      const lastRequestAt = lastRequestAtRef.current.get(requestKey);
      if (lastRequestAt !== undefined && now - lastRequestAt < cooldownMs) {
        return [];
      }

      const coordinatedPromise = (async () => {
        let lastError: unknown = null;

        for (let attempt = 0; attempt <= retries; attempt += 1) {
          if (signal?.aborted) {
            throw new Error("AbortError");
          }

          try {
            const data = await execute(signal);
            lastRequestAtRef.current.set(requestKey, Date.now());
            responseCacheRef.current.set(requestKey, {
              expiresAt: Date.now() + cacheTtlMs,
              data,
            });
            pruneLocalCacheEntries(requestKey);
            return data;
          } catch (error) {
            if (isAbortError(error) || attempt === retries) {
              throw error;
            }
            lastError = error;
            await sleep(getBackoffDelay(attempt));
          }
        }

        throw lastError instanceof Error ? lastError : new Error("Trajectory request failed");
      })().finally(() => {
        inFlightRef.current.delete(requestKey);
      });

      inFlightRef.current.set(requestKey, coordinatedPromise);
      return attachAbortToPromise(coordinatedPromise, signal);
    },
    [pruneLocalCacheEntries],
  );

  const requestTrajectoryBlock = useCallback(
    async ({ date, spanDays, ids, tier, signal }: TrajectoryBlockRequest): Promise<EphemerisData[]> => {
      const requestKey = buildTrajectoryRequestKey(date, spanDays, ids, tier);
      return runCoordinatedRequest({
        requestKey,
        signal,
        cooldownMs: TRAJECTORY_FETCH_COOLDOWN_MS,
        cacheTtlMs: TRAJECTORY_RESPONSE_CACHE_TTL_MS,
        execute: (requestSignal) => fetchTrajectoryRaw(date, spanDays, ids, tier, requestSignal),
      });
    },
    [fetchTrajectoryRaw, runCoordinatedRequest],
  );

  const requestOrbitLines = useCallback(
    async (ids: string[], signal?: AbortSignal): Promise<EphemerisData[]> => {
      const requestKey = `orbit-lines|${uniqueSortedIds(ids).join(",")}`;
      return runCoordinatedRequest({
        requestKey,
        signal,
        cooldownMs: ORBIT_LINE_FETCH_COOLDOWN_MS,
        cacheTtlMs: ORBIT_LINE_RESPONSE_CACHE_TTL_MS,
        execute: async (requestSignal) => {
          const response = await fetch(
            `/api/ephemeris?ids=${uniqueSortedIds(ids).join(",")}&fullOrbit=true&orbitReady=true&orbitLineOnly=true`,
            { signal: requestSignal },
          );
          if (!response.ok) {
            throw new Error(`Orbit line request failed with status ${response.status}`);
          }
          const payload: { data?: EphemerisData[] } = await response.json();
          return Array.isArray(payload.data) ? payload.data : [];
        },
      });
    },
    [runCoordinatedRequest],
  );

  return {
    requestTrajectoryBlock,
    requestOrbitLines,
  };
}

function uniqueSortedIds(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort();
}
