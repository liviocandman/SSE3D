import type { EphemerisData } from '../lib/types';
import { parseRetryAfter } from '../lib/trajectoryRequestErrors';

/** Parse responses off the main thread. Scientific samples stay unchanged;
 * normalization belongs to the trajectory engine, and line detail to rendering. */
const activeJobs = new Map<string, AbortController>();

self.onmessage = async (event: MessageEvent) => {
  const { type, jobId, params } = event.data;
  if (type === 'CANCEL') {
    activeJobs.get(jobId)?.abort();
    activeJobs.delete(jobId);
    return;
  }
  if (type !== 'FETCH') return;

  const controller = new AbortController();
  activeJobs.set(jobId, controller);
  let status: number | undefined;
  let retryAt: number | undefined;
  try {
    const { date, spanDays, ids, origin } = params;
    const url = new URL('/api/ephemeris', origin || self.location.origin);
    url.search = new URLSearchParams({ date, spanDays: String(spanDays), ids: ids.join(',') }).toString();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      status = response.status;
      retryAt = parseRetryAfter(response.headers?.get('Retry-After') ?? null);
      throw new Error(`Trajectory request failed with status ${status}`);
    }
    const payload: { data?: EphemerisData[] } = await response.json();
    if (!Array.isArray(payload.data)) throw new SyntaxError('Invalid trajectory response');
    if (!controller.signal.aborted) {
      self.postMessage({ type: 'SUCCESS', jobId, data: payload.data });
    }
  } catch (error: unknown) {
    if (!controller.signal.aborted) {
      self.postMessage({
        type: 'ERROR', jobId, status, retryAt,
        error: error instanceof Error ? error.message : 'Unknown worker error',
        errorName: error instanceof Error ? error.name : undefined,
      });
    }
  } finally {
    activeJobs.delete(jobId);
  }
};
