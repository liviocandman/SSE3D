import { Redis } from '@upstash/redis';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
  limit: number;
}

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_SECONDS = 60 * 60; // 1 hour
const KEY_PREFIX = 'ratelimit:astronomer';

let redisClient: Redis | null = null;

function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  try {
    redisClient = new Redis({ url, token });
    return redisClient;
  } catch (error) {
    console.warn('[RateLimit] Failed to initialize Redis client:', error);
    return null;
  }
}

export async function checkRateLimit(
  identifier: string,
  limit = DEFAULT_LIMIT,
  windowSeconds = DEFAULT_WINDOW_SECONDS
): Promise<RateLimitResult> {
  const redis = getRedisClient();

  if (!redis) {
    return { allowed: true, remaining: limit, resetSeconds: windowSeconds, limit };
  }

  const key = `${KEY_PREFIX}:${identifier}`;

  try {
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }

    const remaining = Math.max(0, limit - count);
    return {
      allowed: count <= limit,
      remaining,
      resetSeconds: windowSeconds,
      limit,
    };
  } catch (error) {
    console.warn('[RateLimit] Redis error, failing open:', error);
    return { allowed: true, remaining: limit, resetSeconds: windowSeconds, limit };
  }
}
