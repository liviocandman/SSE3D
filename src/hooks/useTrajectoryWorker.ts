import { useEffect, useRef, useCallback } from 'react';
import type { EphemerisData } from '../lib/types';
import { abortError, TrajectoryRequestError } from '@/lib/trajectoryRequestErrors';

export const TRAJECTORY_WORKER_TIMEOUT_MS = 20_000;

interface WorkerRequest {
  resolve: (data: EphemerisData[]) => void;
  reject: (reason: unknown) => void;
}

export function useTrajectoryWorker() {
  const workerRef = useRef<Worker | null>(null);
  const mountedRef = useRef(false);
  const pendingRequests = useRef<Map<string, WorkerRequest>>(new Map());

  const stopWorker = useCallback((reason: Error) => {
    const worker = workerRef.current;
    workerRef.current = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    // Reject wrappers clean up their own timeout and abort listener.
    for (const request of pendingRequests.current.values()) request.reject(reason);
    pendingRequests.current.clear();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopWorker(abortError());
    };
  }, [stopWorker]);

  const getWorker = useCallback(() => {
    if (!mountedRef.current) throw abortError();
    if (workerRef.current) return workerRef.current;

    // Create lazily; a failed worker is replaced only when new work is requested.
    const worker = new Worker(
      new URL('../workers/trajectory.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent) => {
      const { type, jobId, data, error, errorName, status, retryAt } = event.data ?? {};
      const request = pendingRequests.current.get(jobId);
      if (!request) return;
      if (type === 'SUCCESS' && Array.isArray(data)) {
        request.resolve(data);
      } else if (errorName === 'SyntaxError' || type === 'SUCCESS') {
        request.reject(new SyntaxError(error ?? 'Invalid worker response'));
      } else {
        request.reject(new TrajectoryRequestError(error ?? 'Invalid worker response', status, retryAt));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      stopWorker(new Error(event.message || 'Trajectory worker failed'));
    };
    worker.onmessageerror = () => stopWorker(new Error('Unable to decode trajectory worker response'));
    return worker;
  }, [stopWorker]);

  const fetchTrajectoryRaw = useCallback(
    async (date: string, spanDays: number, ids: string[], tier: string, signal?: AbortSignal): Promise<EphemerisData[]> => {
      if (signal?.aborted) throw abortError();
      const worker = getWorker();
      const jobId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      return new Promise<EphemerisData[]>((resolve, reject) => {
        let completed = false;
        const cleanup = () => {
          clearTimeout(timeout);
          pendingRequests.current.delete(jobId);
          signal?.removeEventListener('abort', onAbort);
        };
        const settle = (error?: unknown, data?: EphemerisData[]) => {
          if (completed) return;
          completed = true;
          cleanup();
          if (error !== undefined) reject(error);
          else resolve(data!);
        };
        const onAbort = () => {
          settle(abortError());
          try { worker.postMessage({ type: 'CANCEL', jobId }); } catch { /* Already terminated. */ }
        };
        const timeout = setTimeout(() => {
          // An unresponsive worker may have other stuck jobs: release all callers.
          stopWorker(new Error('Trajectory worker timed out'));
        }, TRAJECTORY_WORKER_TIMEOUT_MS);
        pendingRequests.current.set(jobId, {
          resolve: (data) => settle(undefined, data),
          reject: (error) => settle(error),
        });
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
          worker.postMessage({
            type: 'FETCH', jobId,
            params: { date, spanDays, ids, tier, origin: window.location.origin },
          });
        } catch (error) {
          stopWorker(error instanceof Error ? error : new Error('Worker dispatch failed'));
        }
      });
    }, [getWorker, stopWorker],
  );
  return { fetchTrajectoryRaw };
}
