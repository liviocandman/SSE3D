import { useEffect, useRef, useCallback } from "react";
import type { EphemerisData } from "../lib/types";

interface WorkerRequest {
  resolve: (data: EphemerisData[]) => void;
  reject: (reason: unknown) => void;
}

export function useTrajectoryWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRequests = useRef<Map<string, WorkerRequest>>(new Map());

  useEffect(() => {
    const pending = pendingRequests.current;

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
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const fetchTrajectoryRaw = useCallback(
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

      const jobId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      return new Promise<EphemerisData[]>((resolve, reject) => {
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
    },
    [],
  );

  return { fetchTrajectoryRaw };
}
