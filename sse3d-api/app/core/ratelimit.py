from app.core.redis_client import get_redis
from loguru import logger
from app.core.config import settings

KEY_PREFIX = "ratelimit:astronomer"

async def check_rate_limit(identifier: str) -> dict:
    redis = get_redis()
    limit = settings.rate_limit_requests
    window = settings.rate_limit_window_seconds

    if not redis:
        return {"allowed": True, "remaining": limit, "reset_seconds": window, "limit": limit}

    key = f"{KEY_PREFIX}:{identifier}"

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
        logger.error(f"Redis error in rate limit, failing open: {e}")
        return {"allowed": True, "remaining": limit, "reset_seconds": window, "limit": limit}

