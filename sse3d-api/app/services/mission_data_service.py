from datetime import datetime, timezone
from typing import Optional
from loguru import logger
import numpy as np

from app.models.mission_schemas import (
    MissionStateResponse,
    MissionTrajectoryResponse,
    MissionEventsResponse,
    MissionHealthResponse,
    MissionPhase,
    MissionDataSource,
    MissionLineOfSightStatus,
    MissionPosition,
    MissionVelocity,
    MissionDistances,
    MissionCoordinates,
    MissionTrajectoryPoint,
    MissionTrajectorySegment,
    MissionEvent,
)
from app.core.config import settings
from app.services.mission_arow_client import AROWClient
from app.services.mission_normalizer import normalize_arow_live_payload, create_mission_health
from app.services.mission_cache_service import MissionCacheService
from app.services.spice_engine import compute_mission_relative_geometry, compute_mission_trajectory
from app.services.mission_oem_service import mission_oem_service
from app.services.mission_geometry_service import (
    compute_mission_attitude,
    enrich_mission_geometry,
    transform_to_eclipj2000,
    to_scene_frame,
    derive_scene_coordinates,
)

arow_client = AROWClient()
cache_service = MissionCacheService()

ARTEMIS2_ID = "artemis-2"
ORION_VEHICLE_ID = "orion"
PREDICTED_FALLBACK_EARTH_DISTANCE_KM = 250_000.0
MOON_MEAN_RADIUS_KM = 1_737.4

# Transition tracking for Story 7.2
_last_source: Optional[MissionDataSource] = None
_last_fallback_state: Optional[bool] = None
_last_stale_state: bool = False
_events_cache_signature: Optional[tuple[str, str, int, int]] = None
_events_cache: Optional[list[MissionEvent]] = None
_lunar_flyby_window_cache_signature: Optional[tuple[str, str, int, int]] = None
_lunar_flyby_window_cache: Optional[tuple[str, str, str]] = None

MISSION_LAUNCH_TIMESTAMP = "2026-04-01T14:00:00Z"
MISSION_TLI_TIMESTAMP = "2026-04-01T16:30:00Z"
DEFAULT_LUNAR_FLYBY_TIMESTAMP = "2026-04-05T08:00:00Z"
DEFAULT_SPLASHDOWN_TIMESTAMP = "2026-04-11T18:00:00Z"
LUNAR_FLYBY_WINDOW_HOURS = 6
LUNAR_RETURN_COAST_START_HOUR = 20
LUNAR_RETURN_COAST_START_MINUTE = 30
REENTRY_LEAD_HOURS = 2


async def get_health() -> MissionHealthResponse:
    """
    Centralized health logic for Story 7.1.
    Decides health status based on cache availability and degradation.
    """
    # 1. Check Live Cache
    _, health = await cache_service.get_live_state()
    if health:
        return health

    # 2. Check Last Good State (Degraded)
    _, last_good_health = await cache_service.get_last_good_state()
    if last_good_health:
        # Create a copy to avoid contaminating the cache (P1 fix)
        degraded_health = last_good_health.model_copy(update={
            "status": "degraded",
            "fallback_active": True
        })
        if degraded_health.details:
            # We copy details too to be safe if it's a nested dict
            new_details = degraded_health.details.copy()
            new_details["fallbackActive"] = True
            new_details["reason"] = "Live AROW data unavailable, using last good state."
            degraded_health.details = new_details
        return degraded_health

    # 3. Initializing / Unknown (P2 fix: don't report fallback if just cold start)
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


def _log_source_transition(new_source: MissionDataSource, fallback_active: bool, is_stale: bool = False):
    """
    Transition-based logging for Story 7.2.
    Only logs when source, fallback state, or staleness changes.
    """
    global _last_source, _last_fallback_state, _last_stale_state

    # Source changes
    if new_source != _last_source:
        logger.info(f"MISSION SOURCE CHANGE: {_last_source} -> {new_source}")
        _last_source = new_source

    # Fallback transitions
    if fallback_active != _last_fallback_state:
        if fallback_active:
            logger.warning("MISSION FALLBACK ACTIVATED: System is running on degraded/predicted data.")
        else:
            logger.info("MISSION FALLBACK CLEARED: Live telemetry recovered.")
        _last_fallback_state = fallback_active

    # Telemetry gaps (P2 fix for Story 7.2)
    if is_stale != _last_stale_state:
        if is_stale:
            logger.warning("MISSION TELEMETRY GAP DETECTED: Data freshness exceeds nominal threshold.")
        else:
            logger.info("MISSION TELEMETRY REFRESHED: Nominal data flow resumed.")
        _last_stale_state = is_stale


def _resolve_orion_state_from_oem(timestamp: str):
    oem_state = mission_oem_service.get_state_at(timestamp)
    if not oem_state:
        return None
    return {
        "position": oem_state.position,
        "velocity": oem_state.velocity,
        "input_frame": "EME2000",
        "input_origin": "EARTH",
    }


def _format_iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _format_mission_elapsed_time(timestamp: str) -> str:
    current_dt = _parse_split_timestamp(timestamp)
    launch_dt = _parse_split_timestamp(MISSION_LAUNCH_TIMESTAMP)
    if current_dt <= launch_dt:
        return "0-00:00:00"

    total_seconds = int((current_dt - launch_dt).total_seconds())
    days, rem = divmod(total_seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, seconds = divmod(rem, 60)
    return f"{days}-{hours:02d}:{minutes:02d}:{seconds:02d}"


def _fallback_lunar_flyby_window(center_timestamp: str) -> tuple[str, str, str]:
    center_dt = _parse_split_timestamp(center_timestamp)
    start_dt = datetime.fromtimestamp(
        center_dt.timestamp() - LUNAR_FLYBY_WINDOW_HOURS * 3600,
        tz=timezone.utc,
    )
    end_dt = _resolve_lunar_return_coast_start(center_dt)
    return (
        _format_iso_z(start_dt),
        _format_iso_z(center_dt),
        _format_iso_z(end_dt),
    )


def _resolve_lunar_return_coast_start(reference_dt: datetime) -> datetime:
    transition_dt = reference_dt.astimezone(timezone.utc).replace(
        hour=LUNAR_RETURN_COAST_START_HOUR,
        minute=LUNAR_RETURN_COAST_START_MINUTE,
        second=0,
        microsecond=0,
    )
    if transition_dt <= reference_dt:
        return reference_dt
    return transition_dt


def _derive_lunar_flyby_window(ephemeris) -> tuple[str, str, str]:
    if not settings.spice_enabled:
        return _fallback_lunar_flyby_window(DEFAULT_LUNAR_FLYBY_TIMESTAMP)

    states = mission_oem_service.get_states_between(
        ephemeris.metadata.start_time,
        ephemeris.metadata.stop_time,
        max_points=1500,
        use_adaptive=True,
    )
    if not states:
        return _fallback_lunar_flyby_window(DEFAULT_LUNAR_FLYBY_TIMESTAMP)

    valid_samples: list[tuple[str, datetime, float, float]] = []
    input_frame = ephemeris.metadata.ref_frame or "EME2000"

    for state in states:
        timestamp = state.timestamp if state.timestamp.endswith("Z") else f"{state.timestamp}Z"
        geo_data = compute_mission_relative_geometry(timestamp)
        if not geo_data:
            continue

        rotated_pos, _ = transform_to_eclipj2000(state.position, state.velocity, input_frame, geo_data["et"])
        earth_distance = float((rotated_pos.x ** 2 + rotated_pos.y ** 2 + rotated_pos.z ** 2) ** 0.5)
        moon_rel_eclip = geo_data["moon_pos"] - geo_data["earth_pos"]
        dx = rotated_pos.x - float(moon_rel_eclip[0])
        dy = rotated_pos.y - float(moon_rel_eclip[1])
        dz = rotated_pos.z - float(moon_rel_eclip[2])
        moon_distance = float((dx ** 2 + dy ** 2 + dz ** 2) ** 0.5)
        valid_samples.append((timestamp, state.dt, earth_distance, moon_distance))

    if not valid_samples:
        return _fallback_lunar_flyby_window(DEFAULT_LUNAR_FLYBY_TIMESTAMP)

    closest_idx = min(range(len(valid_samples)), key=lambda index: valid_samples[index][3])
    if valid_samples[closest_idx][3] >= valid_samples[closest_idx][2]:
        return _fallback_lunar_flyby_window(valid_samples[closest_idx][0])

    start_idx = closest_idx
    while start_idx > 0 and valid_samples[start_idx - 1][3] < valid_samples[start_idx - 1][2]:
        start_idx -= 1

    end_idx = closest_idx
    while end_idx < len(valid_samples) - 1 and valid_samples[end_idx + 1][3] < valid_samples[end_idx + 1][2]:
        end_idx += 1

    if start_idx == end_idx:
        return _fallback_lunar_flyby_window(valid_samples[closest_idx][0])

    closest_dt = valid_samples[closest_idx][1]
    derived_end_dt = valid_samples[end_idx][1]
    capped_end_dt = min(derived_end_dt, _resolve_lunar_return_coast_start(closest_dt))
    end_idx = next(
        (
            index
            for index in range(closest_idx, len(valid_samples))
            if valid_samples[index][1] >= capped_end_dt
        ),
        end_idx,
    )

    return (
        valid_samples[start_idx][0],
        valid_samples[closest_idx][0],
        valid_samples[end_idx][0],
    )


def _get_lunar_flyby_window(ephemeris=None) -> tuple[str, str, str]:
    global _lunar_flyby_window_cache_signature, _lunar_flyby_window_cache

    target_ephemeris = ephemeris or mission_oem_service.get_ephemeris()
    if target_ephemeris and target_ephemeris.states:
        signature = (
            target_ephemeris.metadata.start_time,
            target_ephemeris.metadata.stop_time,
            len(target_ephemeris.states),
            1 if settings.spice_enabled else 0,
        )
        if _lunar_flyby_window_cache_signature == signature and _lunar_flyby_window_cache is not None:
            return _lunar_flyby_window_cache

        window = _derive_lunar_flyby_window(target_ephemeris)
        _lunar_flyby_window_cache_signature = signature
        _lunar_flyby_window_cache = window
        return window

    fallback_signature = (
        MISSION_LAUNCH_TIMESTAMP,
        DEFAULT_SPLASHDOWN_TIMESTAMP,
        0,
        1 if settings.spice_enabled else 0,
    )
    if _lunar_flyby_window_cache_signature == fallback_signature and _lunar_flyby_window_cache is not None:
        return _lunar_flyby_window_cache

    window = _fallback_lunar_flyby_window(DEFAULT_LUNAR_FLYBY_TIMESTAMP)
    _lunar_flyby_window_cache_signature = fallback_signature
    _lunar_flyby_window_cache = window
    return window


def _build_mission_events() -> list[MissionEvent]:
    global _events_cache_signature, _events_cache

    ephemeris = mission_oem_service.get_ephemeris()
    if ephemeris and ephemeris.states:
        signature = (
            ephemeris.metadata.start_time,
            ephemeris.metadata.stop_time,
            len(ephemeris.states),
            1 if settings.spice_enabled else 0,
        )
        if _events_cache_signature == signature and _events_cache is not None:
            return _events_cache

        launch_dt = _parse_split_timestamp(MISSION_LAUNCH_TIMESTAMP)
        tli_dt = _parse_split_timestamp(MISSION_TLI_TIMESTAMP)
        _flyby_start_ts, flyby_center_ts, _flyby_end_ts = _get_lunar_flyby_window(ephemeris)
        flyby_dt = _parse_split_timestamp(flyby_center_ts)
        splashdown_dt = _parse_split_timestamp(ephemeris.metadata.stop_time)
    else:
        signature = (
            MISSION_LAUNCH_TIMESTAMP,
            DEFAULT_SPLASHDOWN_TIMESTAMP,
            0,
            1 if settings.spice_enabled else 0,
        )
        if _events_cache_signature == signature and _events_cache is not None:
            return _events_cache

        launch_dt = _parse_split_timestamp(MISSION_LAUNCH_TIMESTAMP)
        tli_dt = _parse_split_timestamp(MISSION_TLI_TIMESTAMP)
        flyby_dt = _parse_split_timestamp(DEFAULT_LUNAR_FLYBY_TIMESTAMP)
        splashdown_dt = _parse_split_timestamp(DEFAULT_SPLASHDOWN_TIMESTAMP)

    reentry_dt = splashdown_dt
    if splashdown_dt > flyby_dt:
        candidate = splashdown_dt.timestamp() - REENTRY_LEAD_HOURS * 3600
        reentry_dt = datetime.fromtimestamp(max(candidate, flyby_dt.timestamp() + 3600), tz=timezone.utc)

    events = [
        MissionEvent(
            id="launch",
            name="Launch",
            description="SLS launch from KSC",
            timestamp=_format_iso_z(launch_dt),
            phase=MissionPhase.LAUNCH,
            isCompleted=False,
        ),
        MissionEvent(
            id="tli",
            name="Trans-Lunar Injection",
            description="ICPS TLI burn",
            timestamp=_format_iso_z(tli_dt),
            phase=MissionPhase.EARTH_DEPARTURE,
            isCompleted=False,
        ),
        MissionEvent(
            id="lunar-flyby",
            name="Lunar Flyby",
            description="Closest approach to Moon",
            timestamp=_format_iso_z(flyby_dt),
            phase=MissionPhase.LUNAR_FLYBY,
            isCompleted=False,
        ),
        MissionEvent(
            id="reentry",
            name="Reentry Interface",
            description="Earth return entry corridor",
            timestamp=_format_iso_z(reentry_dt),
            phase=MissionPhase.REENTRY,
            isCompleted=False,
        ),
        MissionEvent(
            id="splashdown",
            name="Splashdown",
            description="Mission end and recovery",
            timestamp=_format_iso_z(splashdown_dt),
            phase=MissionPhase.SPLASHDOWN,
            isCompleted=False,
        ),
    ]

    _events_cache_signature = signature
    _events_cache = events
    return events


def _derive_current_phase(reference_dt: datetime, events: list[MissionEvent]) -> MissionPhase:
    event_times = {event.id: _parse_split_timestamp(event.timestamp) for event in events}
    flyby_start_ts, _flyby_center_ts, flyby_end_ts = _get_lunar_flyby_window()
    launch_dt = event_times["launch"]
    tli_dt = event_times["tli"]
    reentry_dt = event_times["reentry"]
    splashdown_dt = event_times["splashdown"]
    flyby_window_start = _parse_split_timestamp(flyby_start_ts)
    flyby_window_end = _parse_split_timestamp(flyby_end_ts)

    if reference_dt < launch_dt:
        return MissionPhase.LAUNCH
    if reference_dt < tli_dt:
        return MissionPhase.EARTH_DEPARTURE
    if reference_dt < flyby_window_start:
        return MissionPhase.TRANSLUNAR_COAST
    if reference_dt <= flyby_window_end:
        return MissionPhase.LUNAR_FLYBY
    if reference_dt < reentry_dt:
        return MissionPhase.RETURN_COAST
    if reference_dt < splashdown_dt:
        return MissionPhase.REENTRY
    return MissionPhase.SPLASHDOWN


def get_mission_events(at: Optional[str] = None) -> MissionEventsResponse:
    events = _build_mission_events()
    reference_dt = _parse_split_timestamp(at)
    current_phase = _derive_current_phase(reference_dt, events)

    resolved_events: list[MissionEvent] = []
    next_event: Optional[MissionEvent] = None
    for event in events:
        completed = _parse_split_timestamp(event.timestamp) <= reference_dt
        resolved = MissionEvent(
            id=event.id,
            name=event.name,
            description=event.description,
            timestamp=event.timestamp,
            phase=event.phase,
            isCompleted=completed,
        )
        resolved_events.append(resolved)
        if next_event is None and not completed:
            next_event = resolved

    return MissionEventsResponse(
        missionId=ARTEMIS2_ID,
        events=resolved_events,
        currentPhase=current_phase,
        nextEvent=next_event,
    )


def _norm_km(position: MissionPosition) -> float:
    return float((position.x ** 2 + position.y ** 2 + position.z ** 2) ** 0.5)


def _classify_lunar_occultation(orion_rel_eclip: np.ndarray, moon_rel_eclip: np.ndarray) -> MissionLineOfSightStatus:
    segment_norm_sq = float(np.dot(orion_rel_eclip, orion_rel_eclip))
    if segment_norm_sq <= 0:
        return MissionLineOfSightStatus.CLEAR

    projection = float(np.dot(moon_rel_eclip, orion_rel_eclip) / segment_norm_sq)
    if projection <= 0.0 or projection >= 1.0:
        return MissionLineOfSightStatus.CLEAR

    closest_point = orion_rel_eclip * projection
    clearance = float(np.linalg.norm(moon_rel_eclip - closest_point))
    if clearance <= MOON_MEAN_RADIUS_KM:
        return MissionLineOfSightStatus.LUNAR_OCCULTATION

    return MissionLineOfSightStatus.CLEAR


def _compute_spacecraft_context(
    *,
    phase: MissionPhase,
    position: MissionPosition,
    velocity: MissionVelocity,
    input_frame: str,
    input_origin: str,
    geo_data: dict | None,
):
    attitude_context = compute_mission_attitude(
        orion_pos=position,
        orion_vel=velocity,
        phase=phase,
        input_frame=input_frame,
        input_origin=input_origin,
        et=geo_data["et"] if geo_data else 0.0,
        earth_pos_eclip=geo_data["earth_pos"] if geo_data else None,
        moon_pos_eclip=geo_data["moon_pos"] if geo_data else None,
    )

    if not geo_data:
        return attitude_context

    rotated_pos, _ = transform_to_eclipj2000(position, velocity, input_frame, geo_data["et"])
    relative_orion_eclip = np.array([rotated_pos.x, rotated_pos.y, rotated_pos.z], dtype=float)

    if input_origin.upper() == "EARTH":
        orion_rel_eclip = relative_orion_eclip
        orion_global_eclip = geo_data["earth_pos"] + relative_orion_eclip
    else:
        orion_rel_eclip = relative_orion_eclip - geo_data["earth_pos"]
        orion_global_eclip = relative_orion_eclip

    moon_rel_eclip = geo_data["moon_pos"] - geo_data["earth_pos"]

    return {
        "solar_range_km": float(np.linalg.norm(orion_global_eclip)),
        "line_of_sight_status": _classify_lunar_occultation(orion_rel_eclip, moon_rel_eclip),
        **attitude_context,
    }


def _apply_spacecraft_context(state: MissionStateResponse, context: dict) -> None:
    state.solar_range_km = context.get("solar_range_km")
    state.line_of_sight_status = context.get("line_of_sight_status")
    state.attitude_quaternion = context.get("attitude_quaternion")
    state.inertial_attitude_quaternion = context.get("inertial_attitude_quaternion")
    state.lvlh_attitude_quaternion = context.get("lvlh_attitude_quaternion")
    state.attitude_source = context.get("attitude_source")
    state.attitude_mode = context.get("attitude_mode")
    state.attitude_confidence = context.get("attitude_confidence")
    state.reference_frame = context.get("reference_frame")


def _build_trajectory_point_from_state(
    timestamp: str,
    position: MissionPosition,
    velocity: MissionVelocity,
    segment: MissionTrajectorySegment,
    phase: MissionPhase,
):
    geo_data = compute_mission_relative_geometry(timestamp)
    if geo_data:
        _global_coords, _mission_coords, scene_coords, _distances = enrich_mission_geometry(
            orion_pos=position,
            orion_vel=velocity,
            earth_pos_eclip=geo_data["earth_pos"],
            moon_pos_eclip=geo_data["moon_pos"],
            et=geo_data["et"],
            input_frame="EME2000",
            input_origin="EARTH",
        )
        rotated_pos, rotated_vel = transform_to_eclipj2000(position, velocity, "EME2000", geo_data["et"])
        _scene_pos, scene_vel = to_scene_frame(rotated_pos, rotated_vel)
        scene_pos = MissionPosition(x=scene_coords.x, y=scene_coords.y, z=scene_coords.z)
        return MissionTrajectoryPoint(
            timestamp=timestamp,
            position=scene_pos,
            velocity=scene_vel,
            phase=phase,
            segment=segment,
        )

    fallback_scene = derive_scene_coordinates(position, velocity, input_frame="EME2000")
    rotated_pos, rotated_vel = transform_to_eclipj2000(position, velocity, "EME2000", 0.0)
    _scene_pos, scene_vel = to_scene_frame(rotated_pos, rotated_vel)
    return MissionTrajectoryPoint(
        timestamp=timestamp,
        position=MissionPosition(x=fallback_scene.x, y=fallback_scene.y, z=fallback_scene.z),
        velocity=scene_vel,
        phase=phase,
        segment=segment,
    )


def _build_earth_relative_predicted_position(timestamp: str):
    """
    Build a fallback Orion vector aligned with the current Earth->Moon direction.

    This avoids rendering an arbitrary predicted marker far outside the visible
    Earth-Moon transfer corridor when live or archived telemetry is unavailable.
    """
    geo_data = compute_mission_relative_geometry(timestamp)
    if not geo_data:
        return (
            MissionPosition(x=150000.0, y=200000.0, z=50000.0),
            MissionVelocity(x=1.2, y=-0.5, z=0.1),
            None,
        )

    moon_relative = geo_data["moon_pos"] - geo_data["earth_pos"]
    moon_relative_norm = float((moon_relative[0] ** 2 + moon_relative[1] ** 2 + moon_relative[2] ** 2) ** 0.5)

    if moon_relative_norm <= 0:
        return (
            MissionPosition(x=150000.0, y=200000.0, z=50000.0),
            MissionVelocity(x=1.2, y=-0.5, z=0.1),
            geo_data,
        )

    direction = moon_relative / moon_relative_norm
    orion_relative = direction * PREDICTED_FALLBACK_EARTH_DISTANCE_KM

    return (
        MissionPosition(
            x=float(orion_relative[0]),
            y=float(orion_relative[1]),
            z=float(orion_relative[2]),
        ),
        MissionVelocity(x=0.0, y=0.0, z=0.0),
        geo_data,
    )

async def get_live_mission_state() -> MissionStateResponse:
    """
    Orchestrates fetching live data from AROW, caching, and geometric enrichment via SPICE.
    """
    # 1. Check Cache
    state, _ = await cache_service.get_live_state()
    if state:
        state.phase = get_mission_events(state.source_timestamp).current_phase
        state.mission_elapsed_time = _format_mission_elapsed_time(state.source_timestamp)
        is_stale = state.staleness_seconds > 60
        fallback_active = state.mode == "predicted" or state.source == MissionDataSource.SPICE_PREDICTED
        _log_source_transition(state.source, fallback_active, is_stale)
        return state
        
    try:
        # 2. Fetch AROW
        logger.info("Mission cache miss: fetching from AROW")
        arow_data = await arow_client.fetch_live_data()
        
        # 3. Normalize AROW payload (initial distances might be inaccurate)
        live_state = normalize_arow_live_payload(
            arow_data["raw_payload"],
            arow_data["headers"],
            arow_data["fetched_at"]
        )

        oem_state = _resolve_orion_state_from_oem(live_state.source_timestamp)
        if oem_state:
            live_state.position = oem_state["position"]
            live_state.velocity = oem_state["velocity"]
        live_state.phase = get_mission_events(live_state.source_timestamp).current_phase
        live_state.mission_elapsed_time = _format_mission_elapsed_time(live_state.source_timestamp)

        # Orion must always expose a single Earth-relative render coordinate to the frontend,
        # even when the full SPICE enrichment path is unavailable.
        live_state.scene_coordinates = derive_scene_coordinates(
            live_state.position,
            live_state.velocity,
            input_frame=oem_state["input_frame"] if oem_state else settings.arow_input_frame,
        )
        
        # 4. Enrich with Geometry (SPICE)
        geo_data = compute_mission_relative_geometry(live_state.source_timestamp)
        if geo_data:
            global_coords, mission_coords, scene_coords, distances = enrich_mission_geometry(
                orion_pos=live_state.position,
                orion_vel=live_state.velocity,
                earth_pos_eclip=geo_data["earth_pos"],
                moon_pos_eclip=geo_data["moon_pos"],
                et=geo_data["et"],
                input_frame=oem_state["input_frame"] if oem_state else settings.arow_input_frame,
                input_origin=oem_state["input_origin"] if oem_state else settings.arow_position_origin,
            )
            
            live_state.global_coordinates = global_coords
            live_state.mission_coordinates = mission_coords
            live_state.scene_coordinates = scene_coords
            live_state.distances = distances
            context = _compute_spacecraft_context(
                phase=live_state.phase,
                position=live_state.position,
                velocity=live_state.velocity,
                input_frame=oem_state["input_frame"] if oem_state else settings.arow_input_frame,
                input_origin=oem_state["input_origin"] if oem_state else settings.arow_position_origin,
                geo_data=geo_data,
            )
            _apply_spacecraft_context(live_state, context)
        else:
            context = _compute_spacecraft_context(
                phase=live_state.phase,
                position=live_state.position,
                velocity=live_state.velocity,
                input_frame=oem_state["input_frame"] if oem_state else settings.arow_input_frame,
                input_origin=oem_state["input_origin"] if oem_state else settings.arow_position_origin,
                geo_data=None,
            )
            _apply_spacecraft_context(live_state, context)
        
        # 5. Create Health and update Cache
        live_health = create_mission_health(
            live_state, arow_data["headers"], arow_data["fetched_at"], raw_payload=arow_data["raw_payload"]
        )
        await cache_service.set_live_state(live_state, live_health)
        
        is_stale = live_state.staleness_seconds > 60
        _log_source_transition(live_state.source, False, is_stale)
        return live_state

    except Exception as e:
        logger.warning(f"AROW fetch or enrichment failed: {str(e)}. Attempting fallback to last good state.")
        
        # 6. Fallback
        fallback_state, _ = await cache_service.get_last_good_state()
        if fallback_state:
            # When in fallback, we consider it stale if the data age is high
            is_stale = fallback_state.staleness_seconds > 60
            _log_source_transition(fallback_state.source, True, is_stale)
            return fallback_state
            
        logger.error("No last good state found. Returning predicted data as ultimate fallback.")
        predicted = get_predicted_fallback_state()
        _log_source_transition(predicted.source, True, True) # Predicted is always "gapped" from live
        return predicted

def get_predicted_fallback_state() -> MissionStateResponse:
    now = datetime.now(timezone.utc).isoformat()
    phase = get_mission_events(now).current_phase
    oem_state = _resolve_orion_state_from_oem(now)
    if oem_state:
        position = oem_state["position"]
        velocity = oem_state["velocity"]
        geo_data = compute_mission_relative_geometry(now)
        input_frame = oem_state["input_frame"]
        input_origin = oem_state["input_origin"]
    else:
        position, velocity, geo_data = _build_earth_relative_predicted_position(now)
        input_frame = settings.arow_input_frame
        input_origin = settings.arow_position_origin
    state = MissionStateResponse(
        missionId=ARTEMIS2_ID,
        vehicleId=ORION_VEHICLE_ID,
        mode="predicted",
        phase=phase,
        source=MissionDataSource.SPICE_PREDICTED,
        sourceTimestamp=now,
        stalenessSeconds=999.9,
        position=position,
        velocity=velocity,
        distances=MissionDistances(earthKm=_norm_km(position), moonKm=130000.0),
        missionElapsedTime=_format_mission_elapsed_time(now),
        globalCoordinates=MissionCoordinates(x=position.x, y=position.z, z=-position.y),
        missionCoordinates=MissionCoordinates(x=position.x, y=position.y, z=position.z),
        sceneCoordinates=MissionCoordinates(x=position.x, y=position.z, z=-position.y)
    )
    if geo_data:
        global_coords, mission_coords, scene_coords, distances = enrich_mission_geometry(
            orion_pos=state.position,
            orion_vel=state.velocity,
            earth_pos_eclip=geo_data["earth_pos"],
            moon_pos_eclip=geo_data["moon_pos"],
            et=geo_data["et"],
            input_frame=input_frame,
            input_origin=input_origin,
        )
        state.global_coordinates = global_coords
        state.mission_coordinates = mission_coords
        state.scene_coordinates = scene_coords
        state.distances = distances
        context = _compute_spacecraft_context(
            phase=state.phase,
            position=state.position,
            velocity=state.velocity,
            input_frame=input_frame,
            input_origin=input_origin,
            geo_data=geo_data,
        )
        _apply_spacecraft_context(state, context)
    else:
        state.scene_coordinates = derive_scene_coordinates(
            state.position,
            state.velocity,
            input_frame=input_frame,
        )
        state.distances = MissionDistances(earthKm=_norm_km(state.position), moonKm=state.distances.moon_km)
        context = _compute_spacecraft_context(
            phase=state.phase,
            position=state.position,
            velocity=state.velocity,
            input_frame=input_frame,
            input_origin=input_origin,
            geo_data=None,
        )
        _apply_spacecraft_context(state, context)
    return state

def get_replay_state(timestamp: str) -> MissionStateResponse:
    phase = get_mission_events(timestamp).current_phase
    oem_state = _resolve_orion_state_from_oem(timestamp)
    if oem_state:
        position = oem_state["position"]
        velocity = oem_state["velocity"]
        geo_data = compute_mission_relative_geometry(timestamp)
        input_frame = oem_state["input_frame"]
        input_origin = oem_state["input_origin"]
    else:
        position, velocity, geo_data = _build_earth_relative_predicted_position(timestamp)
        input_frame = settings.arow_input_frame
        input_origin = settings.arow_position_origin
    state = MissionStateResponse(
        missionId=ARTEMIS2_ID,
        vehicleId=ORION_VEHICLE_ID,
        mode="replay",
        phase=phase,
        source=MissionDataSource.ARCHIVE,
        sourceTimestamp=timestamp,
        stalenessSeconds=0.0,
        position=position,
        velocity=velocity,
        distances=MissionDistances(earthKm=_norm_km(position), moonKm=130000.0),
        missionElapsedTime=_format_mission_elapsed_time(timestamp),
        globalCoordinates=MissionCoordinates(x=position.x, y=position.z, z=-position.y),
        missionCoordinates=MissionCoordinates(x=position.x, y=position.y, z=position.z),
        sceneCoordinates=MissionCoordinates(x=position.x, y=position.z, z=-position.y)
    )

    state.scene_coordinates = derive_scene_coordinates(
        state.position,
        state.velocity,
        input_frame=input_frame,
    )
    
    # Enrich replay with proper SPICE geometry if available
    if geo_data:
        global_coords, mission_coords, scene_coords, distances = enrich_mission_geometry(
            orion_pos=state.position,
            orion_vel=state.velocity,
            earth_pos_eclip=geo_data["earth_pos"],
            moon_pos_eclip=geo_data["moon_pos"],
            et=geo_data["et"],
            input_frame=input_frame,
            input_origin=input_origin,
        )
        state.global_coordinates = global_coords
        state.mission_coordinates = mission_coords
        state.scene_coordinates = scene_coords
        state.distances = distances
        context = _compute_spacecraft_context(
            phase=state.phase,
            position=state.position,
            velocity=state.velocity,
            input_frame=input_frame,
            input_origin=input_origin,
            geo_data=geo_data,
        )
        _apply_spacecraft_context(state, context)
    else:
        state.distances = MissionDistances(earthKm=_norm_km(state.position), moonKm=state.distances.moon_km)
        context = _compute_spacecraft_context(
            phase=state.phase,
            position=state.position,
            velocity=state.velocity,
            input_frame=input_frame,
            input_origin=input_origin,
            geo_data=None,
        )
        _apply_spacecraft_context(state, context)
        
    return state

def _parse_split_timestamp(timestamp: str | None) -> datetime:
    if not timestamp:
        return datetime.now(timezone.utc)

    raw = timestamp.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def get_mission_trajectory(at: str | None = None) -> MissionTrajectoryResponse:
    """
    Returns the mission trajectory, past and planned points.
    OEM is the primary source for Orion trajectory when available.
    """
    past_points = []
    planned_points = []

    ephemeris = mission_oem_service.get_ephemeris()
    events = _build_mission_events()
    if ephemeris and ephemeris.states:
        split_dt = _parse_split_timestamp(at)
        states = mission_oem_service.get_states_between(
            ephemeris.metadata.start_time,
            ephemeris.metadata.stop_time,
            max_points=1500,
        )

        for state in states:
            segment = (
                MissionTrajectorySegment.PAST
                if state.dt <= split_dt
                else MissionTrajectorySegment.PLANNED
            )
            phase = _derive_current_phase(state.dt, events)
            point = _build_trajectory_point_from_state(
                state.timestamp if state.timestamp.endswith("Z") else f"{state.timestamp}Z",
                state.position,
                state.velocity,
                segment,
                phase,
            )
            if segment == MissionTrajectorySegment.PAST:
                past_points.append(point)
            else:
                planned_points.append(point)

        if not past_points and states:
            first = states[0]
            past_points.append(
                _build_trajectory_point_from_state(
                    first.timestamp if first.timestamp.endswith("Z") else f"{first.timestamp}Z",
                    first.position,
                    first.velocity,
                    MissionTrajectorySegment.PAST,
                    _derive_current_phase(first.dt, events),
                )
            )

        if not planned_points and states:
            last = states[-1]
            planned_points.append(
                _build_trajectory_point_from_state(
                    last.timestamp if last.timestamp.endswith("Z") else f"{last.timestamp}Z",
                    last.position,
                    last.velocity,
                    MissionTrajectorySegment.PLANNED,
                    _derive_current_phase(last.dt, events),
                )
            )
    else:
        traj_data = compute_mission_trajectory("2026-04-03T12:00:00Z", "2026-04-05T12:00:00Z", steps=2)
        if traj_data and len(traj_data["times"]) == 2:
            # Start point (past)
            et_start = traj_data["times"][0]
            earth_pos_start = traj_data["earth_pos"][0]
            moon_pos_start = traj_data["moon_pos"][0]

            # End point (planned)
            et_end = traj_data["times"][1]
            earth_pos_end = traj_data["earth_pos"][1]
            moon_pos_end = traj_data["moon_pos"][1]

            # Determine Orion states: try from SPICE, fallback to mock
            if traj_data.get("orion_pos") is not None and len(traj_data["orion_pos"]) == 2:
                orion_start = MissionPosition(
                    x=traj_data["orion_pos"][0][0],
                    y=traj_data["orion_pos"][0][1],
                    z=traj_data["orion_pos"][0][2]
                )
                orion_vel_start = MissionVelocity(
                    x=traj_data["orion_vel"][0][0],
                    y=traj_data["orion_vel"][0][1],
                    z=traj_data["orion_vel"][0][2]
                )
                orion_end = MissionPosition(
                    x=traj_data["orion_pos"][1][0],
                    y=traj_data["orion_pos"][1][1],
                    z=traj_data["orion_pos"][1][2]
                )
                orion_vel_end = MissionVelocity(
                    x=traj_data["orion_vel"][1][0],
                    y=traj_data["orion_vel"][1][1],
                    z=traj_data["orion_vel"][1][2]
                )
                input_frame = "ECLIPJ2000" # Since SPICE returns in ECLIPJ2000
            else:
                # We assume Orion moves from some coords to some coords
                orion_start = MissionPosition(x=100000, y=150000, z=40000)
                orion_vel_start = MissionVelocity(x=1.1, y=-0.4, z=0.05)

                orion_end = MissionPosition(x=350000, y=50000, z=10000)
                orion_vel_end = MissionVelocity(x=0.5, y=-0.2, z=-0.1)
                input_frame = settings.arow_input_frame

            # Enrich the start point
            _global_start, _, scene_start, _ = enrich_mission_geometry(
                orion_start, orion_vel_start, earth_pos_start, moon_pos_start, et_start, input_frame, settings.arow_position_origin
            )
            rotated_start_pos, rotated_start_vel = transform_to_eclipj2000(
                orion_start, orion_vel_start, input_frame, et_start
            )
            _, scene_vel_start = to_scene_frame(rotated_start_pos, rotated_start_vel)
            scene_pos_start = MissionPosition(x=scene_start.x, y=scene_start.y, z=scene_start.z)

            # Enrich the end point
            _global_end, _, scene_end, _ = enrich_mission_geometry(
                orion_end, orion_vel_end, earth_pos_end, moon_pos_end, et_end, input_frame, settings.arow_position_origin
            )
            rotated_end_pos, rotated_end_vel = transform_to_eclipj2000(
                orion_end, orion_vel_end, input_frame, et_end
            )
            _, scene_vel_end = to_scene_frame(rotated_end_pos, rotated_end_vel)
            scene_pos_end = MissionPosition(x=scene_end.x, y=scene_end.y, z=scene_end.z)

            past_points.append(MissionTrajectoryPoint(
                timestamp="2026-04-03T12:00:00Z",
                position=scene_pos_start,
                velocity=scene_vel_start,
                phase=MissionPhase.TRANSLUNAR_COAST,
                segment=MissionTrajectorySegment.PAST
            ))

            planned_points.append(MissionTrajectoryPoint(
                timestamp="2026-04-05T12:00:00Z",
                position=scene_pos_end,
                velocity=scene_vel_end,
                phase=MissionPhase.LUNAR_FLYBY,
                segment=MissionTrajectorySegment.PLANNED
            ))
        else:
            fallback_start_pos, fallback_start_vel = to_scene_frame(
                MissionPosition(x=100000, y=150000, z=40000),
                MissionVelocity(x=1.1, y=-0.4, z=0.05),
            )
            fallback_end_pos, fallback_end_vel = to_scene_frame(
                MissionPosition(x=350000, y=50000, z=10000),
                MissionVelocity(x=0.5, y=-0.2, z=-0.1),
            )
            past_points.append(MissionTrajectoryPoint(
                timestamp="2026-04-03T12:00:00Z",
                position=fallback_start_pos,
                velocity=fallback_start_vel,
                phase=MissionPhase.TRANSLUNAR_COAST,
                segment=MissionTrajectorySegment.PAST
            ))
            planned_points.append(MissionTrajectoryPoint(
                timestamp="2026-04-05T12:00:00Z",
                position=fallback_end_pos,
                velocity=fallback_end_vel,
                phase=MissionPhase.LUNAR_FLYBY,
                segment=MissionTrajectorySegment.PLANNED
            ))
        
    return MissionTrajectoryResponse(
        missionId=ARTEMIS2_ID,
        past=past_points,
        planned=planned_points
    )
