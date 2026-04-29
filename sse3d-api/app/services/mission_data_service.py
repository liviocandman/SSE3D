from datetime import datetime, timezone
from loguru import logger
import numpy as np
from typing import Optional

from app.models.mission_schemas import (
    MissionStateResponse,
    MissionHealthResponse,
    MissionDataSource,
    MissionDistances,
    MissionCoordinates,
    MissionPosition,
    MissionVelocity,
)
from app.core.config import settings
from app.services.mission_arow_client import AROWClient
from app.services.mission_normalizer import normalize_arow_live_payload, create_mission_health
from app.services.mission_cache_service import MissionCacheService
from app.services.spice_engine import compute_mission_relative_geometry
from app.services.mission_oem_service import mission_oem_service
from app.services.mission_geometry_service import derive_scene_coordinates

from app.services.mission_source_tracker import mission_source_tracker
from app.services.mission_event_service import mission_event_service, format_mission_elapsed_time
from app.services.mission_state_builder import (
    enrich_state_with_geometry,
    build_base_mission_state,
    _resolve_orion_state_from_oem
)
from app.services.mission_trajectory_builder import get_mission_trajectory

arow_client = AROWClient()
cache_service = MissionCacheService()

ARTEMIS2_ID = "artemis-2"
ORION_VEHICLE_ID = "orion"
PREDICTED_FALLBACK_EARTH_DISTANCE_KM = 250_000.0


async def get_mission_events(at: Optional[str] = None):
    return await mission_event_service.get_mission_events(at)


async def get_health() -> MissionHealthResponse:
    _, health = await cache_service.get_live_state()
    if health:
        return health

    _, last_good_health = await cache_service.get_last_good_state()
    if last_good_health:
        degraded_health = last_good_health.model_copy(update={
            "status": "degraded",
            "fallback_active": True
        })
        if degraded_health.details:
            new_details = degraded_health.details.copy()
            new_details["fallbackActive"] = True
            new_details["reason"] = "Live AROW data unavailable, using last good state."
            degraded_health.details = new_details
        return degraded_health

    now = datetime.now(timezone.utc).isoformat()
    return MissionHealthResponse(
        missionId=ARTEMIS2_ID,
        status="initializing",
        source=MissionDataSource.AROW_LIVE,
        lastUpdate=now,
        currentSource=MissionDataSource.AROW_LIVE,
        dataAgeSeconds=0.0,
        fallbackActive=False,
        coverageStart=None,
        coverageEnd=None,
        details={"status": "initializing", "info": "Waiting for first data fetch..."}
    )



async def get_live_mission_state() -> MissionStateResponse:
    state, _ = await cache_service.get_live_state()
    if state:
        phase_data = await get_mission_events(state.source_timestamp)
        state.phase = phase_data.current_phase
        state.mission_elapsed_time = format_mission_elapsed_time(state.source_timestamp)
        is_stale = state.staleness_seconds > 60
        fallback_active = state.mode == "predicted" or state.source == MissionDataSource.SPICE_PREDICTED
        mission_source_tracker.log_transition(state.source, fallback_active, is_stale)
        return state
        
    try:
        logger.info("Mission cache miss: fetching from AROW")
        arow_data = await arow_client.fetch_live_data()
        
        live_state = normalize_arow_live_payload(
            arow_data["raw_payload"],
            arow_data["headers"],
            arow_data["fetched_at"]
        )

        oem_state = _resolve_orion_state_from_oem(live_state.source_timestamp)
        if oem_state:
            live_state.position = oem_state["position"]
            live_state.velocity = oem_state["velocity"]
        
        phase_data = await get_mission_events(live_state.source_timestamp)
        live_state.phase = phase_data.current_phase
        live_state.mission_elapsed_time = format_mission_elapsed_time(live_state.source_timestamp)

        geo_data = await compute_mission_relative_geometry(live_state.source_timestamp)
        input_frame = oem_state["input_frame"] if oem_state else settings.arow_input_frame
        input_origin = oem_state["input_origin"] if oem_state else settings.arow_position_origin
        
        enrich_state_with_geometry(live_state, geo_data, input_frame, input_origin)
        
        live_health = create_mission_health(
            live_state, arow_data["headers"], arow_data["fetched_at"], raw_payload=arow_data["raw_payload"]
        )
        await cache_service.set_live_state(live_state, live_health)
        
        is_stale = live_state.staleness_seconds > 60
        mission_source_tracker.log_transition(live_state.source, False, is_stale)
        return live_state

    except Exception as e:
        logger.warning(f"AROW fetch or enrichment failed: {str(e)}. Attempting fallback to last good state.")
        
        fallback_state, _ = await cache_service.get_last_good_state()
        if fallback_state:
            is_stale = fallback_state.staleness_seconds > 60
            mission_source_tracker.log_transition(fallback_state.source, True, is_stale)
            return fallback_state
            
        logger.error("No last good state found. Returning predicted data as ultimate fallback.")
        predicted = await get_predicted_fallback_state()
        mission_source_tracker.log_transition(predicted.source, True, True)
        return predicted

async def get_predicted_fallback_state() -> MissionStateResponse:
    now = datetime.now(timezone.utc).isoformat()
    return await build_base_mission_state(now, "predicted", MissionDataSource.SPICE_PREDICTED, 999.9, get_mission_events)

async def get_replay_state(timestamp: str) -> MissionStateResponse:
    return await build_base_mission_state(timestamp, "replay", MissionDataSource.ARCHIVE, 0.0, get_mission_events)

