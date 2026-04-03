import type {
  MissionEventsResponse,
  MissionHealth,
  MissionState,
  MissionTrajectory,
} from '@/lib/missionTypes';

const LOCAL_CACHE_TTL_MS = 5_000;
const DEFAULT_RETRIES = 2;
const BASE_DELAY_MS = 300;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type MissionRequestOptions = {
  signal?: AbortSignal;
};

const requestCache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const cached = requestCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    requestCache.delete(key);
    return null;
  }

  return cached.value as T;
}

function setCached<T>(key: string, value: T): T {
  requestCache.set(key, {
    value,
    expiresAt: Date.now() + LOCAL_CACHE_TTL_MS,
  });
  return value;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelay(attempt: number): number {
  return BASE_DELAY_MS * (attempt + 1);
}

async function fetchJsonWithRetry<T>(
  path: string,
  cacheKey: string,
  options?: MissionRequestOptions
): Promise<T> {
  const cached = getCached<T>(cacheKey);
  if (cached) {
    return cached;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= DEFAULT_RETRIES; attempt += 1) {
    try {
      if (options?.signal?.aborted) {
        throw new DOMException('Mission request aborted', 'AbortError');
      }

      const response = await fetch(path, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: options?.signal,
      });

      if (!response.ok) {
        throw new Error(`Mission API request failed with status ${response.status}`);
      }

      const data = (await response.json()) as T;
      return setCached(cacheKey, data);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }

      lastError = error instanceof Error ? error : new Error('Mission API request failed');
      if (attempt < DEFAULT_RETRIES) {
        await sleep(getBackoffDelay(attempt));
      }
    }
  }

  throw lastError ?? new Error('Mission API request failed');
}

export async function fetchMissionState(
  at?: string,
  options?: MissionRequestOptions
): Promise<MissionState> {
  const params = new URLSearchParams();
  if (at) {
    params.set('at', at);
  }

  const query = params.toString();
  const path = `/api/missions/artemis2/state${query ? `?${query}` : ''}`;

  return fetchJsonWithRetry<MissionState>(
    path,
    `mission-state:${query || 'live'}`,
    options
  );
}

export async function fetchMissionTrajectory(options?: MissionRequestOptions): Promise<MissionTrajectory> {
  return fetchJsonWithRetry<MissionTrajectory>(
    '/api/missions/artemis2/trajectory',
    'mission-trajectory',
    options
  );
}

export async function fetchMissionEvents(options?: MissionRequestOptions): Promise<MissionEventsResponse> {
  return fetchJsonWithRetry<MissionEventsResponse>(
    '/api/missions/artemis2/events',
    'mission-events',
    options
  );
}

export async function fetchMissionHealth(options?: MissionRequestOptions): Promise<MissionHealth> {
  return fetchJsonWithRetry<MissionHealth>(
    '/api/missions/artemis2/health',
    'mission-health',
    options
  );
}

export function clearMissionClientCache(): void {
  requestCache.clear();
}
