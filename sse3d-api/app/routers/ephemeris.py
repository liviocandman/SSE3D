from fastapi import APIRouter, Query
from datetime import date, timedelta, datetime
from app.models.schemas import EphemerisResponse, EphemerisMeta, EphemerisData
from app.services.nasa_client import fetch_all_parallel, MOON_PARENTS
from app.services.cache_service import get_bulk_cached, set_bulk_cached, get_moon_year_cached, set_moon_year_cached
from app.data.fallback import load_fallback
import asyncio
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ephemeris", tags=["Ephemeris"])

ALL_BODY_IDS = ["10", "199", "299", "399", "499", "599", "699", "799", "899"]

async def process_moon_request(moon_id: str, target_date: date, span_days: int) -> EphemerisData | None:
    year = target_date.year
    moon_data = await get_moon_year_cached(moon_id, year)
    
    # Cache Miss: Fetch full year from NASA and cache it
    if not moon_data:
        from app.services.nasa_client import fetch_moon_year
        import httpx
        parent_id = MOON_PARENTS.get(moon_id, "10")
        async with httpx.AsyncClient() as client:
            moon_data = await fetch_moon_year(client, moon_id, parent_id, year)
            if moon_data:
                await set_moon_year_cached(moon_id, year, moon_data)
                
    if not moon_data or not moon_data.trajectory:
        return None

    # Slice the requested span
    start_dt = datetime(target_date.year, target_date.month, target_date.day)
    end_dt = start_dt + timedelta(days=span_days)
    
    sliced_traj = []
    for point in moon_data.trajectory:
        try:
            # Handle NASA formats like "2026-Mar-26 00:00" or "2026-Mar-26 00:00:00.0000"
            ts_clean = point.timestamp.split('.')[0] # Remove milliseconds if any
            if len(ts_clean) > 16:
                pt_dt = datetime.strptime(ts_clean, "%Y-%b-%d %H:%M:%S")
            else:
                pt_dt = datetime.strptime(ts_clean, "%Y-%b-%d %H:%M")
                
            if start_dt <= pt_dt <= end_dt:
                sliced_traj.append(point)
        except Exception:
            # Fallback for ISO or other formats
            try:
                pt_dt = datetime.fromisoformat(point.timestamp.replace('Z', ''))
                if start_dt <= pt_dt <= end_dt:
                    sliced_traj.append(point)
            except Exception:
                continue
    
    return EphemerisData(
        bodyId=moon_data.body_id,
        name=moon_data.name,
        position=sliced_traj[0].position if sliced_traj else moon_data.position,
        velocity=sliced_traj[0].velocity if sliced_traj else moon_data.velocity,
        timestamp=target_date.isoformat(),
        parentId=moon_data.parent_id,
        trajectory=sliced_traj
    )

@router.get("", response_model=EphemerisResponse, response_model_by_alias=True)
async def get_ephemeris(
    target_date: date = Query(default=None, alias="date"),
    ids: str = Query(default=None),
    center_body: str = Query(default="10"),
    span_days: int = Query(default=30, alias="spanDays", ge=1, le=1825),
    full_orbit: bool = Query(default=False, alias="fullOrbit"),
    force: bool = Query(default=False),
):
    try:
        actual_date = target_date if target_date else date.today()
        
        # Coarsen date for normal trajectories to 3-day blocks. 
        # This dramatically increases cache hits during timeline scrubbing.
        if not full_orbit:
            days_since_epoch = (actual_date - date(2000, 1, 1)).days
            rounded_days = (days_since_epoch // 3) * 3
            actual_date = date(2000, 1, 1) + timedelta(days=rounded_days)

        date_str = actual_date.isoformat()
        body_ids = [i.strip() for i in ids.split(",")] if ids else ALL_BODY_IDS

        # Separate moons and planets
        moon_ids = [bid for bid in body_ids if bid in MOON_PARENTS]
        planet_ids = [bid for bid in body_ids if bid not in MOON_PARENTS]

        cached = []
        missing_planets = planet_ids

        # Handle Planets
        if not force and planet_ids:
            # Full orbits use a static cache key independent of the target date
            cache_key = "FULL_ORBIT" if full_orbit else f"{date_str}_{span_days}"
            cached_planets, missing_planets = await get_bulk_cached(planet_ids, cache_key, center=center_body)
            cached.extend(cached_planets)

        # Handle Moons
        if moon_ids:
            moon_tasks = [process_moon_request(mid, actual_date, span_days) for mid in moon_ids]
            moon_results = await asyncio.gather(*moon_tasks)
            for res in moon_results:
                if res:
                    cached.append(res)

        if not missing_planets:
            return EphemerisResponse(
                data=cached,
                meta=EphemerisMeta(
                    source="CACHE_HIT",
                    timestamp=date.today().isoformat(),
                    requested_date=date_str,
                    cache_hits=len(cached),
                    cache_misses=0,
                ),
            )

        fresh = await fetch_all_parallel(missing_planets, date_str, center_body=center_body, span_days=span_days, full_orbit=full_orbit)

        fetched_ids = {item.body_id for item in fresh}
        for bid in missing_planets:
            if bid not in fetched_ids:
                fallback_item = load_fallback(bid)
                if fallback_item:
                    fresh.append(fallback_item)

        if fresh:
            cache_key = "FULL_ORBIT" if full_orbit else f"{date_str}_{span_days}"
            await set_bulk_cached(cache_key, fresh, center=center_body)

        return EphemerisResponse(
            data=cached + fresh,
            meta=EphemerisMeta(
                source="NASA_LIVE_AND_CACHE",
                timestamp=date.today().isoformat(),
                requested_date=date_str,
                cache_hits=len(cached),
                cache_misses=len(missing_planets),
            ),
        )
    except Exception as e:
        import traceback
        logger.error(f"[Ephemeris Router] Critical error: {str(e)}\n{traceback.format_exc()}")
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=str(e))
