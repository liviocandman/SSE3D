import threading
from typing import Optional
from upstash_redis import AsyncRedis
from app.core.config import settings
from loguru import logger

class RedisClient:
    _instance: Optional[AsyncRedis] = None
    _lock = threading.Lock()

    @classmethod
    def get_instance(cls) -> Optional[AsyncRedis]:
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    if not settings.upstash_redis_rest_url or not settings.upstash_redis_rest_token:
                        logger.warning("Redis credentials missing. Redis features will fail-open.")
                        return None
                    
                    logger.info("Initializing Redis singleton (Upstash)")
                    cls._instance = AsyncRedis(
                        url=settings.upstash_redis_rest_url,
                        token=settings.upstash_redis_rest_token,
                    )
        return cls._instance

def get_redis() -> Optional[AsyncRedis]:
    """
    Returns the singleton instance of the Upstash Redis client.
    Ensures lazy initialization and returns None if credentials are missing.
    """
    return RedisClient.get_instance()
