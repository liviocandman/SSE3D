from fastapi import APIRouter, Query
from datetime import date
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
    force: bool = Query(default=False),
):
    date_str = target_date.isoformat() if target_date else date.today().isoformat()
    body_ids = [i.strip() for i in ids.split(",")] if ids else ALL_BODY_IDS

    if not force:
        # Note: Cache key should ideally include span_days now
        cached, missing = await get_bulk_cached(body_ids, f"{date_str}_{span_days}", center=center_body)
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

    fresh = await fetch_all_parallel(missing, date_str, center_body=center_body, span_days=span_days)

    fetched_ids = {item.body_id for item in fresh}
    for bid in missing:
        if bid not in fetched_ids:
            fallback_item = load_fallback(bid)
            if fallback_item:
                fresh.append(fallback_item)

    await set_bulk_cached(f"{date_str}_{span_days}", fresh, center=center_body)

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
