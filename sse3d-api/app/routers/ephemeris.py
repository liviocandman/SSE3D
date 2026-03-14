from fastapi import APIRouter, Query
from datetime import date
from app.models.schemas import EphemerisResponse, EphemerisMeta, EphemerisData
from app.services.nasa_client import fetch_all_parallel
from app.services.cache_service import get_bulk_cached, set_bulk_cached
from app.data.fallback import load_fallback

router = APIRouter(prefix="/ephemeris", tags=["Ephemeris"])

ALL_BODY_IDS = ["10", "199", "299", "399", "499", "599", "699", "799", "899"]

@router.get("", response_model=EphemerisResponse)
async def get_ephemeris(
    target_date: date = Query(default=None, alias="date"),
    ids: str = Query(default=None),
    force: bool = Query(default=False),
):
    date_str = target_date.isoformat() if target_date else date.today().isoformat()
    body_ids = [i.strip() for i in ids.split(",")] if ids else ALL_BODY_IDS

    if not force:
        cached, missing = await get_bulk_cached(body_ids, date_str)
    else:
        cached, missing = [], body_ids

    if not missing:
        return EphemerisResponse(
            data=cached,
            meta=EphemerisMeta(
                source="CACHE_HIT",
                timestamp=date.today().isoformat(),
                requestedDate=date_str,
                cacheHits=len(cached),
                cacheMisses=0,
            ),
        )

    fresh = await fetch_all_parallel(missing, date_str)

    fetched_ids = {item.body_id for item in fresh}
    for bid in missing:
        if bid not in fetched_ids:
            fallback_item = load_fallback(bid)
            if fallback_item:
                fresh.append(fallback_item)

    await set_bulk_cached(date_str, fresh)

    return EphemerisResponse(
        data=cached + fresh,
        meta=EphemerisMeta(
            source="NASA_LIVE",
            timestamp=date.today().isoformat(),
            requestedDate=date_str,
            cacheHits=len(cached),
            cacheMisses=len(missing),
        ),
    )
