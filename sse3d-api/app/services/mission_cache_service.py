from typing import Optional, Tuple
from upstash_redis import AsyncRedis
from loguru import logger
from app.core.config import settings
from app.models.mission_schemas import MissionStateResponse, MissionHealthResponse

# Cache Keys
CACHE_KEY_LIVE_STATE = "mission:artemis2:live:state"
CACHE_KEY_LIVE_HEALTH = "mission:artemis2:live:health"
CACHE_KEY_LAST_GOOD_STATE = "mission:artemis2:live:last_good_state"
CACHE_KEY_LAST_GOOD_HEALTH = "mission:artemis2:live:last_good_health"

class MissionCacheService:
    def __init__(self):
        self.redis = None
        if settings.upstash_redis_rest_url and settings.upstash_redis_rest_token:
            self.redis = AsyncRedis(
                url=settings.upstash_redis_rest_url,
                token=settings.upstash_redis_rest_token,
            )
        self.ttl = settings.arow_cache_ttl_seconds

    async def get_live_state(self) -> Tuple[Optional[MissionStateResponse], Optional[MissionHealthResponse]]:
        """
        Retrieves the current live state and health from cache.
        """
        if not self.redis:
            return None, None
            
        try:
            state_data = await self.redis.get(CACHE_KEY_LIVE_STATE)
            health_data = await self.redis.get(CACHE_KEY_LIVE_HEALTH)
            
            state = MissionStateResponse.model_validate_json(state_data) if state_data else None
            health = MissionHealthResponse.model_validate_json(health_data) if health_data else None
            
            if state:
                logger.debug("Mission cache hit (live state)")
            return state, health
        except Exception as e:
            logger.error(f"Redis error getting live state: {e}")
            return None, None

    async def set_live_state(self, state: MissionStateResponse, health: MissionHealthResponse):
        """
        Updates the current live state and 'last good' state in cache.
        """
        if not self.redis:
            return
            
        try:
            state_json = state.model_dump_json(by_alias=True)
            health_json = health.model_dump_json(by_alias=True)
            
            # Update current live cache with TTL
            await self.redis.set(CACHE_KEY_LIVE_STATE, state_json, ex=self.ttl)
            await self.redis.set(CACHE_KEY_LIVE_HEALTH, health_json, ex=self.ttl)
            
            # Update 'last good' cache (no expiration)
            await self.redis.set(CACHE_KEY_LAST_GOOD_STATE, state_json)
            await self.redis.set(CACHE_KEY_LAST_GOOD_HEALTH, health_json)
            
            logger.debug("Mission cache updated")
        except Exception as e:
            logger.error(f"Redis error setting live state: {e}")

    async def get_last_good_state(self) -> Tuple[Optional[MissionStateResponse], Optional[MissionHealthResponse]]:
        """
        Retrieves the last known good state and health from cache (fallback).
        """
        if not self.redis:
            return None, None
            
        try:
            state_data = await self.redis.get(CACHE_KEY_LAST_GOOD_STATE)
            health_data = await self.redis.get(CACHE_KEY_LAST_GOOD_HEALTH)
            
            state = MissionStateResponse.model_validate_json(state_data) if state_data else None
            health = MissionHealthResponse.model_validate_json(health_data) if health_data else None
            
            if state:
                logger.info("Mission fallback: using last good state from cache")
            return state, health
        except Exception as e:
            logger.error(f"Redis error getting last good state: {e}")
            return None, None
