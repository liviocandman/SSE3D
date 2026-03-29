from upstash_redis import AsyncRedis
from app.models.schemas import EphemerisData
from app.core.config import settings
import json
import zlib
import base64

_TTL = {
    frozenset({"599", "699", "799", "899"}): 86400,
    frozenset({"399"}): 3600,
}

def _get_ttl(body_id: str, date_str: str = "") -> int:
    # Trajectories (30-day blocks) should last longer
    if "_" in date_str:
        return 172800  # 48 hours
    
    for ids, ttl in _TTL.items():
        if body_id in ids:
            return ttl
    return 21600

def _cache_key(body_id: str, date: str, center: str = "10") -> str:
    if center == "10":
        return f"ephemeris:{body_id}:{date}"
    return f"ephemeris:{body_id}:center_{center}:{date}"

async def get_bulk_cached(
    body_ids: list[str], date: str, center: str = "10"
) -> tuple[list[EphemerisData], list[str]]:
    try:
        redis = AsyncRedis(
            url=settings.upstash_redis_rest_url,
            token=settings.upstash_redis_rest_token,
        )
        cached, missing = [], []
        for bid in body_ids:
            raw = await redis.get(_cache_key(bid, date, center=center))
            if raw:
                cached.append(EphemerisData.model_validate(json.loads(raw)))
            else:
                missing.append(bid)
        return cached, missing
    except Exception as e:
        print(f"[Cache] Error reading from Redis: {e}")
        return [], body_ids

async def set_bulk_cached(date: str, items: list[EphemerisData], center: str = "10") -> None:
    try:
        redis = AsyncRedis(
            url=settings.upstash_redis_rest_url,
            token=settings.upstash_redis_rest_token,
        )
        for item in items:
            key = _cache_key(item.body_id, date, center=center)
            ttl = _get_ttl(item.body_id, date_str=date)
            await redis.set(key, item.model_dump_json(by_alias=True), ex=ttl)
    except Exception as e:
        print(f"[Cache] Error writing to Redis: {e}")

# --- Moon Year Cache (Compressed) ---
async def get_moon_year_cached(body_id: str, year: int) -> EphemerisData | None:
    try:
        redis = AsyncRedis(
            url=settings.upstash_redis_rest_url,
            token=settings.upstash_redis_rest_token,
        )
        key = f"ephemeris:moon:{body_id}:year:{year}"
        compressed_base64 = await redis.get(key)
        if compressed_base64:
            compressed_data = base64.b64decode(compressed_base64)
            json_str = zlib.decompress(compressed_data).decode('utf-8')
            return EphemerisData.model_validate(json.loads(json_str))
        return None
    except Exception as e:
        print(f"[Cache] Error reading compressed moon year from Redis: {e}")
        return None

async def set_moon_year_cached(body_id: str, year: int, data: EphemerisData) -> None:
    try:
        redis = AsyncRedis(
            url=settings.upstash_redis_rest_url,
            token=settings.upstash_redis_rest_token,
        )
        key = f"ephemeris:moon:{body_id}:year:{year}"
        json_str = data.model_dump_json(by_alias=True)
        compressed_data = zlib.compress(json_str.encode('utf-8'))
        compressed_base64 = base64.b64encode(compressed_data).decode('utf-8')
        
        # Cache for a very long time (e.g., 30 days) since it's a full year
        await redis.set(key, compressed_base64, ex=2592000)
    except Exception as e:
        print(f"[Cache] Error writing compressed moon year to Redis: {e}")
