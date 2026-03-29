import sys
import os
import asyncio
from datetime import datetime, timedelta
import httpx
from loguru import logger
from dotenv import load_dotenv

# Add parent directory to path so we can import from app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from app.models.schemas import EphemerisData
from app.services.nasa_client import fetch_moon_year, MOON_PARENTS
from app.services.cache_service import set_moon_year_cached
from app.core.config import settings

# 2026 as the base year for the cache
WARM_YEAR = 2026

async def main():
    if not settings.upstash_redis_rest_url:
        logger.error("Redis URL not configured. Exiting.")
        return

    logger.info(f"Starting Redis Warming for Moons (Year {WARM_YEAR})")
    
    async with httpx.AsyncClient() as client:
        # Batch requests to avoid NASA 503 errors
        moons = list(MOON_PARENTS.items())
        batch_size = 3
        
        for i in range(0, len(moons), batch_size):
            batch = moons[i:i + batch_size]
            tasks = [fetch_moon_year(client, moon_id, parent_id, WARM_YEAR) for moon_id, parent_id in batch]
            
            results = await asyncio.gather(*tasks)
            
            for result in results:
                if result:
                    await set_moon_year_cached(result.body_id, WARM_YEAR, result)
                    logger.success(f"Cached {len(result.trajectory)} points for Moon {result.body_id}")
            
            if i + batch_size < len(moons):
                logger.info("Sleeping 2s to respect NASA rate limits...")
                await asyncio.sleep(2)

    logger.info("Warming complete!")

if __name__ == "__main__":
    asyncio.run(main())
