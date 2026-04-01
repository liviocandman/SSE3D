from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query
from loguru import logger

from app.data.fallback import load_fallback
from app.models.schemas import EphemerisData, EphemerisMeta, EphemerisResponse
from app.services.spice_engine import fetch_all_spice
from app.services.spice_kernel_manager import get_spice_runtime_status

router = APIRouter(prefix="/ephemeris", tags=["Ephemeris"])

DEFAULT_BODY_IDS = ["10", "199", "299", "399", "499", "599", "699", "799", "899"]


@router.get("", response_model=EphemerisResponse, response_model_by_alias=True)
async def get_ephemeris(
    target_date: date = Query(default=None, alias="date"),
    ids: str = Query(default=None),
    center_body: str = Query(default="10"),
    span_days: int = Query(default=30, alias="spanDays", ge=1, le=1825),
    full_orbit: bool = Query(default=False, alias="fullOrbit"),
    force: bool = Query(default=False),
):
    del force  # kept for API compatibility

    try:
        actual_date = target_date if target_date else date.today()

        # Preserve previous date coarsening to reduce trajectory churn during scrubbing.
        if not full_orbit:
            days_since_epoch = (actual_date - date(2000, 1, 1)).days
            rounded_days = (days_since_epoch // 3) * 3
            actual_date = date(2000, 1, 1) + timedelta(days=rounded_days)

        date_str = actual_date.isoformat()
        body_ids = [i.strip() for i in ids.split(",")] if ids else DEFAULT_BODY_IDS

        spice_data = await fetch_all_spice(
            body_ids,
            date_str,
            center_body=center_body,
            span_days=span_days,
            full_orbit=full_orbit,
        )

        fetched_ids = {item.body_id for item in spice_data}
        fallback_data: list[EphemerisData] = []
        for body_id in body_ids:
            if body_id in fetched_ids:
                continue
            fallback_item = load_fallback(body_id)
            if fallback_item:
                fallback_data.append(fallback_item)

        response_data = spice_data + fallback_data
        if not response_data:
            status = get_spice_runtime_status()
            detail = "No ephemeris data available."
            if status.errors:
                detail = f"SPICE kernels not ready: {'; '.join(status.errors)}"
            raise HTTPException(status_code=503, detail=detail)

        source = "SPICE_AND_FALLBACK" if fallback_data else "SPICE_KERNELS"
        return EphemerisResponse(
            data=response_data,
            meta=EphemerisMeta(
                source=source,
                timestamp=date.today().isoformat(),
                requested_date=date_str,
                cache_hits=0,
                cache_misses=max(0, len(body_ids) - len(spice_data)),
            ),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[Ephemeris Router] Critical error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
