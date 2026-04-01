import type { EphemerisData, EphemerisTrajectory } from '../lib/types';

/**
 * Trajectory Web Worker
 * Offloads heavy JSON parsing and normalization from the Main Thread.
 */

const activeJobs = new Map<string, AbortController>();

/**
 * Normalizes trajectory points (sorting and uniqueness)
 * Duplicate logic from trajectoryEngine.ts to keep worker self-contained if needed,
 * but using module imports if possible.
 */
function normalizePoints(points: EphemerisTrajectory[]): EphemerisTrajectory[] {
  const unique = new Map<string, EphemerisTrajectory>();
  for (const point of points) {
    unique.set(point.timestamp, point);
  }
  
  return Array.from(unique.values()).sort((a, b) => {
    const t1 = new Date(a.timestamp.includes('Z') ? a.timestamp : `${a.timestamp}Z`).getTime();
    const t2 = new Date(b.timestamp.includes('Z') ? b.timestamp : `${b.timestamp}Z`).getTime();
    return t1 - t2;
  });
}

self.onmessage = async (e: MessageEvent) => {
  const { type, jobId, params } = e.data;

  if (type === 'CANCEL') {
    const controller = activeJobs.get(jobId);
    if (controller) {
      controller.abort();
      activeJobs.delete(jobId);
    }
    return;
  }

  if (type === 'FETCH') {
    const controller = new AbortController();
    activeJobs.set(jobId, controller);

    const { date, spanDays, ids, origin } = params;
    const urlParams = new URLSearchParams({
      date,
      spanDays: spanDays.toString(),
      ids: ids.join(','),
    });

    try {
      const baseUrl = origin || '';
      const response = await fetch(`${baseUrl}/api/ephemeris?${urlParams.toString()}`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // HEAVY LIFTING: JSON parsing on background thread
      const payload = await response.json();
      const rawData = payload.data as EphemerisData[];

      // OPTIMIZATION: Initial normalization on background thread
      const processedData = rawData.map(body => ({
        ...body,
        trajectory: body.trajectory ? normalizePoints(body.trajectory) : []
      }));

      self.postMessage({
        type: 'SUCCESS',
        jobId,
        data: processedData,
      });
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        console.log(`[Worker] Job ${jobId} aborted`);
      } else {
        self.postMessage({
          type: 'ERROR',
          jobId,
          error: error.message || 'Unknown worker error',
        });
      }
    } finally {
      activeJobs.delete(jobId);
    }
  }
};
