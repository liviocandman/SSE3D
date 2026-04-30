from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query
from loguru import logger

from app.data.fallback import load_fallback
from app.models.schemas import EphemerisData, EphemerisMeta, EphemerisResponse, OrbitLineProfile
from app.services.spice_engine import fetch_all_spice
from app.services.spice_kernel_manager import get_spice_runtime_status
from app.services.cache_service import get_bulk_cached, set_bulk_cached
from app.core.config import settings

router = APIRouter(prefix="/ephemeris", tags=["Ephemeris"])

DEFAULT_BODY_IDS = ["10", "199", "299", "399", "499", "599", "699", "799", "899"]


@router.get("", response_model=EphemerisResponse, response_model_by_alias=True)
async def get_ephemeris(
    target_date: date = Query(default=None, alias="date"),
    ids: str = Query(default=None),
    center_body: str = Query(default="10"),
    span_days: int = Query(default=30, alias="spanDays", ge=1, le=1825),
    full_orbit: bool = Query(default=False, alias="fullOrbit"),
    orbit_ready: bool = Query(default=False, alias="orbitReady"),
    orbit_profile: OrbitLineProfile = Query(default=OrbitLineProfile.AUTO, alias="orbitProfile"),
    orbit_line_only: bool = Query(default=False, alias="orbitLineOnly"),
    force: bool = Query(default=False),
):
    try:
        actual_date = target_date if target_date else date.today()

        if full_orbit:
            # Complete orbits (background lines) use 10-day coarsening to maximize cache efficiency.
            days_since_epoch = (actual_date - date(2000, 1, 1)).days
            rounded_days = (days_since_epoch // 10) * 10
            actual_date = date(2000, 1, 1) + timedelta(days=rounded_days)

        date_str = actual_date.isoformat()
        body_ids = [i.strip() for i in ids.split(",")] if ids else DEFAULT_BODY_IDS
        orbit_ready_effective = bool(orbit_ready and settings.orbit_ready_enabled)

        if force:
            cached_data = []
            missing_ids = body_ids
        else:
            cached_data, missing_ids = await get_bulk_cached(
                body_ids,
                date_str,
                center=center_body,
                span_days=span_days,
                full_orbit=full_orbit,
                orbit_ready=orbit_ready_effective,
                orbit_profile=orbit_profile,
                orbit_line_only=orbit_line_only,
            )

        fetched_spice: list[EphemerisData] = []
        if missing_ids:
            fetched_spice = await fetch_all_spice(
                missing_ids,
                date_str,
                center_body=center_body,
                span_days=span_days,
                full_orbit=full_orbit,
                orbit_ready=orbit_ready_effective,
                orbit_profile=orbit_profile,
                orbit_line_only=orbit_line_only,
            )
            if fetched_spice:
                await set_bulk_cached(
                    date_str,
                    fetched_spice,
                    center=center_body,
                    span_days=span_days,
                    full_orbit=full_orbit,
                    orbit_ready=orbit_ready_effective,
                    orbit_profile=orbit_profile,
                    orbit_line_only=orbit_line_only,
                )

        spice_by_id = {item.body_id: item for item in cached_data}
        for item in fetched_spice:
            spice_by_id[item.body_id] = item

        spice_data = [spice_by_id[body_id] for body_id in body_ids if body_id in spice_by_id]

        fetched_ids = {item.body_id for item in spice_data}
        fallback_data: list[EphemerisData] = []
        for body_id in body_ids:
            if body_id in fetched_ids:
                continue
            fallback_item = load_fallback(body_id)
            if fallback_item:
                fallback_data.append(fallback_item)

        response_data = spice_data + fallback_data
        resolved_ids = {item.body_id for item in response_data}
        unresolved_ids = [body_id for body_id in body_ids if body_id not in resolved_ids]

        if orbit_ready_effective and unresolved_ids:
            logger.warning(
                "[Ephemeris Router] Orbit-ready request unresolved for IDs: {} (date={}, fullOrbit={})",
                ",".join(unresolved_ids),
                date_str,
                full_orbit,
            )
            raise HTTPException(
                status_code=503,
                detail=f"Orbit-ready data unavailable for IDs: {', '.join(unresolved_ids)}",
            )

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
                cache_hits=len(cached_data),
                cache_misses=max(0, len(body_ids) - len(cached_data)),
            ),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[Ephemeris Router] Critical error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
