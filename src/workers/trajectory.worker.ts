import type { EphemerisData, EphemerisTrajectory } from '../lib/types';
import { densifyWithCatmullRom } from '../lib/catmullRom';

/**
 * Trajectory Web Worker
 * Offloads heavy JSON parsing, normalization, and densification from the Main Thread.
 */

const activeJobs = new Map<string, AbortController>();

// Quality-gated subdivision counts (confirmed thresholds)
const SUBDIVISIONS_BY_TIER: Record<string, number> = {
  high: 8,   // 7 synthetic pts per gap
  mid:  4,   // 3 synthetic pts per gap
  low:  2,   // 1 synthetic pt per gap
};

/**
 * Normalizes trajectory points (sorting and uniqueness)
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

    const { date, spanDays, ids, origin, tier } = params;
    const subdivisions = SUBDIVISIONS_BY_TIER[tier ?? 'mid'];

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

      // OPTIMIZATION: Initial normalization and Catmull-Rom densification on background thread
      const processedData = rawData.map(body => ({
        ...body,
        trajectory: body.trajectory 
          ? densifyWithCatmullRom(normalizePoints(body.trajectory), subdivisions) 
          : []
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
