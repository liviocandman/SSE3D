from fastapi import APIRouter, Query
from datetime import date, timedelta
from app.models.schemas import EphemerisResponse, EphemerisMeta
from app.services.nasa_client import fetch_all_parallel
from app.services.cache_service import get_bulk_cached, set_bulk_cached
from app.data.fallback import load_fallback

router = APIRouter(prefix="/ephemeris", tags=["Ephemeris"])

ALL_BODY_IDS = ["10", "199", "299", "399", "499", "599", "699", "799", "899"]

@router.get("", response_model=EphemerisResponse, response_model_by_alias=True)
async def get_ephemeris(
    target_date: date = Query(default=None, alias="date"),
    ids: str = Query(default=None),
    center_body: str = Query(default="10"),
    span_days: int = Query(default=30, alias="spanDays", ge=1, le=1825),
    full_orbit: bool = Query(default=False, alias="fullOrbit"),
    force: bool = Query(default=False),
):
    actual_date = target_date if target_date else date.today()
    
    # Coarsen date for normal trajectories to 3-day blocks. 
    # This dramatically increases cache hits during timeline scrubbing.
    if not full_orbit:
        days_since_epoch = (actual_date - date(2000, 1, 1)).days
        rounded_days = (days_since_epoch // 3) * 3
        actual_date = date(2000, 1, 1) + timedelta(days=rounded_days)

    date_str = actual_date.isoformat()
    body_ids = [i.strip() for i in ids.split(",")] if ids else ALL_BODY_IDS

    if not force:
        # Full orbits use a static cache key independent of the target date
        cache_key = "FULL_ORBIT" if full_orbit else f"{date_str}_{span_days}"
        cached, missing = await get_bulk_cached(body_ids, cache_key, center=center_body)
    else:
        cached, missing = [], body_ids

    if not missing:
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

    fresh = await fetch_all_parallel(missing, date_str, center_body=center_body, span_days=span_days, full_orbit=full_orbit)

    fetched_ids = {item.body_id for item in fresh}
    for bid in missing:
        if bid not in fetched_ids:
            fallback_item = load_fallback(bid)
            if fallback_item:
                fresh.append(fallback_item)

    cache_key = "FULL_ORBIT" if full_orbit else f"{date_str}_{span_days}"
    await set_bulk_cached(cache_key, fresh, center=center_body)

    return EphemerisResponse(
        data=cached + fresh,
        meta=EphemerisMeta(
            source="NASA_LIVE",
            timestamp=date.today().isoformat(),
            requested_date=date_str,
            cache_hits=len(cached),
            cache_misses=len(missing),
        ),
    )
