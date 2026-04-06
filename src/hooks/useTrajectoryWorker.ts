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
      worker.terminate();
      workerRef.current = null;
    };
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

      const jobId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      return new Promise((resolve, reject) => {
        pendingRequests.current.set(jobId, { resolve, reject });

        // Handle external abort signal
        if (signal) {
          signal.addEventListener("abort", () => {
            workerRef.current?.postMessage({ type: "CANCEL", jobId });
            const req = pendingRequests.current.get(jobId);
            if (req) {
              req.reject(new Error("AbortError"));
              pendingRequests.current.delete(jobId);
            }
          });
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

  return { fetchTrajectory };
}
