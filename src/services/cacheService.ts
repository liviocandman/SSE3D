/**
 * Redis Cache Service using Upstash
 * Provides caching layer for ephemeris data with TTL strategy
 */

import { Redis } from '@upstash/redis';
import type { EphemerisData } from './nasaClient';

// --- Constants ---

// TTL in seconds based on orbital speed
const TTL_CONFIG = {
  // Outer planets move slowly - cache for 24 hours
  SLOW_PLANETS: 86400, // 24h
  // Inner planets - cache for 6 hours
  INNER_PLANETS: 21600, // 6h
  // Earth/Moon - cache for 1 hour (faster relative motion)
  FAST_BODIES: 3600, // 1h
};

// Body IDs by speed category
const SLOW_PLANET_IDS = ['599', '699', '799', '899']; // Jupiter, Saturn, Uranus, Neptune
const FAST_BODY_IDS = ['399', '301']; // Earth, Moon

// Cache key prefix
const CACHE_PREFIX = 'ephemeris';

// --- Redis Client Singleton ---

let redisClient: Redis | null = null;

function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn('[Cache] Redis credentials not configured - caching disabled');
    return null;
  }

  try {
    redisClient = new Redis({ url, token });
    return redisClient;
  } catch (error) {
    console.error('[Cache] Failed to initialize Redis client:', error);
    return null;
  }
}

// --- Helper Functions ---

/**
 * Generate cache key for ephemeris data
 */
function getCacheKey(bodyId: string, date: string, centerBody = '10'): string {
  if (centerBody === '10') {
    return `${CACHE_PREFIX}:${bodyId}:${date}`;
  }
  return `${CACHE_PREFIX}:${bodyId}:center_${centerBody}:${date}`;
}

/**
 * Get TTL based on body ID
 */
function getTTL(bodyId: string): number {
  if (FAST_BODY_IDS.includes(bodyId)) {
    return TTL_CONFIG.FAST_BODIES;
  }
  if (SLOW_PLANET_IDS.includes(bodyId)) {
    return TTL_CONFIG.SLOW_PLANETS;
  }
  return TTL_CONFIG.INNER_PLANETS;
}

// --- Public API ---

/**
 * Get cached ephemeris data for a single body
 * Returns null if not cached or Redis unavailable
 */
export async function getCachedEphemeris(
  bodyId: string,
  date: string,
  centerBody = '10'
): Promise<EphemerisData | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const key = getCacheKey(bodyId, date, centerBody);
    const cached = await redis.get<EphemerisData>(key);
    return cached;
  } catch (error) {
    console.error(`[Cache] Error getting cached data for ${bodyId}:`, error);
    return null;
  }
}

/**
 * Cache ephemeris data for a single body
 */
export async function setCachedEphemeris(
  bodyId: string,
  date: string,
  data: EphemerisData,
  centerBody = '10'
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    const key = getCacheKey(bodyId, date, centerBody);
    const ttl = getTTL(bodyId);
    await redis.set(key, data, { ex: ttl });
    return true;
  } catch (error) {
    console.error(`[Cache] Error caching data for ${bodyId}:`, error);
    return false;
  }
}

/**
 * Get cached ephemeris data for multiple bodies
 * Returns array of cached data and list of missing body IDs
 */
export async function getCachedBulkEphemeris(
  bodyIds: string[],
  date: string,
  centerBody = '10'
): Promise<{ cached: EphemerisData[]; missing: string[] }> {
  const redis = getRedisClient();

  if (!redis) {
    return { cached: [], missing: bodyIds };
  }

  const cached: EphemerisData[] = [];
  const missing: string[] = [];

  // Check cache for each body
  await Promise.all(
    bodyIds.map(async (bodyId) => {
      const data = await getCachedEphemeris(bodyId, date, centerBody);
      if (data) {
        cached.push(data);
      } else {
        missing.push(bodyId);
      }
    })
  );

  return { cached, missing };
}

/**
 * Cache multiple ephemeris records
 */
export async function setCachedBulkEphemeris(
  date: string,
  dataArray: EphemerisData[],
  centerBody = '10'
): Promise<void> {
  await Promise.all(
    dataArray.map((data) => setCachedEphemeris(data.bodyId, date, data, centerBody))
  );
}

/**
 * Check if Redis is available
 */
export async function isCacheAvailable(): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}
