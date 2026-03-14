from upstash_redis import AsyncRedis
from app.core.config import settings

KEY_PREFIX = "ratelimit:astronomer"

async def check_rate_limit(identifier: str) -> dict:
    redis = AsyncRedis(
        url=settings.upstash_redis_rest_url,
        token=settings.upstash_redis_rest_token,
    )
    key = f"{KEY_PREFIX}:{identifier}"
    limit = settings.rate_limit_requests
    window = settings.rate_limit_window_seconds

    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, window)

        ttl = await redis.ttl(key)
        reset_seconds = max(0, ttl)

        return {
            "allowed": count <= limit,
            "remaining": max(0, limit - count),
            "reset_seconds": reset_seconds,
            "limit": limit,
        }
    except Exception as e:
        print(f"[RateLimit] Redis error, failing open: {e}")
        return {"allowed": True, "remaining": limit, "reset_seconds": window, "limit": limit}
