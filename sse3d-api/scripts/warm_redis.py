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
from app.services.nasa_client import fetch_moon_year, MOON_PARENTS, _fetch_single
from app.services.cache_service import set_moon_year_cached, set_bulk_cached
from app.core.config import settings

# 2026 as the base year for the cache
WARM_YEAR = 2026
PLANET_IDS = ["199", "299", "399", "499", "599", "699", "799", "899", "999"]

async def main():
    if not settings.upstash_redis_rest_url:
        logger.error("Redis URL not configured. Exiting.")
        return

    logger.info(f"Starting Redis Warming for Solar System (Year {WARM_YEAR})")
    
    async with httpx.AsyncClient() as client:
        # --- Task 1: Moons (Full Year) ---
        logger.info("Step 1: Warming Moon Year Cache...")
        moons = list(MOON_PARENTS.items())
        batch_size = 3
        
        for i in range(0, len(moons), batch_size):
            batch = moons[i:i + batch_size]
            tasks = [fetch_moon_year(client, moon_id, parent_id, WARM_YEAR) for moon_id, parent_id in batch]
            results = await asyncio.gather(*tasks)
            
            for result in results:
                if result:
                    await set_moon_year_cached(result.body_id, WARM_YEAR, result)
                    logger.success(f"Cached year for Moon {result.body_id}")
            
            if i + batch_size < len(moons):
                await asyncio.sleep(1.0)

        # --- Task 2: Planets (Full Orbits) ---
        logger.info("Step 2: Warming Planet Full Orbits...")
        date_str = f"{WARM_YEAR}-01-01"
        for body_id in PLANET_IDS:
            logger.info(f"Fetching Full Orbit for Planet {body_id}...")
            result = await _fetch_single(client, body_id, date_str, full_orbit=True)
            if result:
                await set_bulk_cached("FULL_ORBIT", [result])
                logger.success(f"Cached FULL_ORBIT for {body_id}")
            await asyncio.sleep(1.5) # Gentle spacing for NASA

    logger.info("Warming complete!")

if __name__ == "__main__":
    asyncio.run(main())
