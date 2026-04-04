import asyncio
from app.services.mission_cache_service import MissionCacheService

async def test():
    c = MissionCacheService()
    try:
        state, health = await c.get_live_state()
        print("STATE:", state)
    except Exception as e:
        print("ERROR:", e)

asyncio.run(test())
