import sys
import os
import asyncio

import httpx
from loguru import logger
from dotenv import load_dotenv

# Add parent directory to path so we can import from app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from app.services.nasa_client import fetch_moon_year, MOON_PARENTS, _fetch_single  # noqa: E402
from app.services.cache_service import set_moon_year_cached, set_bulk_cached  # noqa: E402
from app.core.config import settings  # noqa: E402

# 2026 as the base year for the cache
WARM_YEAR = 2026
PLANET_IDS = ["199", "299", "399", "499", "599", "699", "799", "899", "999"]

async def main():
    if not settings.upstash_redis_rest_url:
        logger.error("Redis URL not configured. Exiting.")
        return

    logger.info(f"Starting Redis Warming for Solar System (Year {WARM_YEAR})")
    
    # CRÍTICO 1: Timeout de 120s para permitir à NASA calcular 1 ano inteiro de horas
    timeout = httpx.Timeout(120.0, connect=60.0)
    
    async with httpx.AsyncClient(timeout=timeout) as client:
        # --- Task 1: Moons (Full Year) ---
        logger.info("Step 1: Warming Moon Year Cache...")
        moons = list(MOON_PARENTS.items())
        
        for moon_id, parent_id in moons:
            logger.info(f"Fetching full year for Moon {moon_id}...")
            try:
                result = await fetch_moon_year(client, moon_id, parent_id, WARM_YEAR)
                if result:
                    await set_moon_year_cached(moon_id, WARM_YEAR, result)
                    logger.success(f"Cached year for Moon {moon_id}")
            except Exception as e:
                logger.error(f"NASA API Failed for Moon {moon_id}: {e}")
            
            await asyncio.sleep(2.0)

        # --- Task 2: Planets (Full Orbits) ---
        logger.info("Step 2: Warming Planet Full Orbits...")
        date_str = f"{WARM_YEAR}-01-01"
        for body_id in PLANET_IDS:
            logger.info(f"Fetching Full Orbit for Planet {body_id}...")
            try:
                result = await _fetch_single(client, body_id, date_str, full_orbit=True)
                if result:
                    await set_bulk_cached("FULL_ORBIT", [result])
                    logger.success(f"Cached FULL_ORBIT for {body_id}")
            except Exception as e:
                logger.error(f"Failed to fetch planet {body_id}: {e}")
                
            await asyncio.sleep(2.0) # Gentle spacing for NASA

    logger.info("Warming complete!")

if __name__ == "__main__":
    asyncio.run(main())