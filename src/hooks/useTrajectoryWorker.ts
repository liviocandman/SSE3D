import { useEffect, useRef, useCallback } from "react";
import type { EphemerisData } from "../lib/types";
import { buildTrajectoryRequestKey } from "@/lib/trajectoryPolicy";

interface WorkerRequest {
  resolve: (data: EphemerisData[]) => void;
  reject: (reason: unknown) => void;
}

interface ResponseCacheEntry {
  expiresAt: number;
  data: EphemerisData[];
}

const RESPONSE_CACHE_TTL_MS = 5000;

export function useTrajectoryWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRequests = useRef<Map<string, WorkerRequest>>(new Map());
  const inFlightByKeyRef = useRef<Map<string, Promise<EphemerisData[]>>>(new Map());
  const responseCacheRef = useRef<Map<string, ResponseCacheEntry>>(new Map());

  useEffect(() => {
    const pending = pendingRequests.current;
    const inFlight = inFlightByKeyRef.current;
    const responseCache = responseCacheRef.current;

    // Initialize worker with standard Next.js / Webpack / Vite compatible syntax
    const worker = new Worker(
      new URL("../workers/trajectory.worker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (e: MessageEvent) => {
      const { type, jobId, data, error } = e.data;
      const request = pendingRequests.current.get(jobId);

      if (!request) return;

      if (type === "SUCCESS") {
        request.resolve(data);
      } else if (type === "ERROR") {
        request.reject(new Error(error));
      }

      pendingRequests.current.delete(jobId);
    };

    workerRef.current = worker;

    return () => {
      pending.forEach((request) => request.reject(new Error("AbortError")));
      pending.clear();
      inFlight.clear();
      responseCache.clear();
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const clearExpiredCacheEntries = useCallback(() => {
    const now = Date.now();
    for (const [key, value] of responseCacheRef.current) {
      if (value.expiresAt <= now) {
        responseCacheRef.current.delete(key);
      }
    }
  }, []);

  const fetchTrajectory = useCallback(
    async (
      date: string,
      spanDays: number,
      ids: string[],
      tier: string,
      signal?: AbortSignal,
    ): Promise<EphemerisData[]> => {
      if (!workerRef.current) {
        throw new Error("Worker not initialized");
      }

      const requestKey = buildTrajectoryRequestKey(date, spanDays, ids, tier);
      clearExpiredCacheEntries();

      const cached = responseCacheRef.current.get(requestKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
      }

      const inFlight = inFlightByKeyRef.current.get(requestKey);
      if (inFlight) {
        if (!signal) {
          return inFlight;
        }

        return new Promise<EphemerisData[]>((resolve, reject) => {
          if (signal.aborted) {
            reject(new Error("AbortError"));
            return;
          }

          let cancelled = false;
          const onAbort = () => {
            cancelled = true;
            signal.removeEventListener("abort", onAbort);
            reject(new Error("AbortError"));
          };

          signal.addEventListener("abort", onAbort, { once: true });

          inFlight
            .then((data) => {
              signal.removeEventListener("abort", onAbort);
              if (!cancelled) {
                resolve(data);
              }
            })
            .catch((err) => {
              signal.removeEventListener("abort", onAbort);
              if (!cancelled) {
                reject(err);
              }
            });
        });
      }

      const jobId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const requestPromise = new Promise<EphemerisData[]>((resolve, reject) => {
        let completed = false;

        const cleanup = () => {
          pendingRequests.current.delete(jobId);
          if (signal && abortHandler) {
            signal.removeEventListener("abort", abortHandler);
          }
        };

        const abortHandler = signal
          ? () => {
              if (completed) return;
              completed = true;
              workerRef.current?.postMessage({ type: "CANCEL", jobId });
              cleanup();
              reject(new Error("AbortError"));
            }
          : null;

        pendingRequests.current.set(jobId, {
          resolve: (data) => {
            if (completed) return;
            completed = true;
            cleanup();
            resolve(data);
          },
          reject: (err) => {
            if (completed) return;
            completed = true;
            cleanup();
            reject(err);
          },
        });

        if (signal && abortHandler) {
          signal.addEventListener("abort", abortHandler);
        }

        workerRef.current?.postMessage({
          type: "FETCH",
          jobId,
          params: {
            date,
            spanDays,
            ids,
            tier,
            origin: "",
          },
        });
      });

      const dedupedPromise = requestPromise
        .then((data) => {
          responseCacheRef.current.set(requestKey, {
            expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
            data,
          });
          return data;
        })
        .finally(() => {
          inFlightByKeyRef.current.delete(requestKey);
        });

      inFlightByKeyRef.current.set(requestKey, dedupedPromise);
      return dedupedPromise;
    },
    [clearExpiredCacheEntries],
  );

  return { fetchTrajectory };
}
