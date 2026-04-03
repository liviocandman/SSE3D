from datetime import datetime, timezone
from loguru import logger

from app.models.mission_schemas import (
    MissionStateResponse,
    MissionTrajectoryResponse,
    MissionPhase,
    MissionDataSource,
    MissionPosition,
    MissionVelocity,
    MissionDistances,
    MissionCoordinates,
    MissionTrajectoryPoint,
    MissionTrajectorySegment
)
from app.core.config import settings
from app.services.mission_arow_client import AROWClient
from app.services.mission_normalizer import normalize_arow_live_payload, create_mission_health
from app.services.mission_cache_service import MissionCacheService
from app.services.spice_engine import compute_mission_relative_geometry, compute_mission_trajectory
from app.services.mission_oem_service import mission_oem_service
from app.services.mission_geometry_service import (
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


def _norm_km(position: MissionPosition) -> float:
    return float((position.x ** 2 + position.y ** 2 + position.z ** 2) ** 0.5)


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
        
        # 5. Create Health and update Cache
        live_health = create_mission_health(
            live_state, arow_data["headers"], arow_data["fetched_at"], raw_payload=arow_data["raw_payload"]
        )
        await cache_service.set_live_state(live_state, live_health)
        
        return live_state

    except Exception as e:
        logger.warning(f"AROW fetch or enrichment failed: {str(e)}. Attempting fallback to last good state.")
        
        # 6. Fallback
        fallback_state, _ = await cache_service.get_last_good_state()
        if fallback_state:
            return fallback_state
            
        logger.error("No last good state found. Returning predicted data as ultimate fallback.")
        return get_predicted_fallback_state()

def get_predicted_fallback_state() -> MissionStateResponse:
    now = datetime.now(timezone.utc).isoformat()
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
        phase=MissionPhase.TRANSLUNAR_COAST,
        source=MissionDataSource.SPICE_PREDICTED,
        sourceTimestamp=now,
        stalenessSeconds=999.9,
        position=position,
        velocity=velocity,
        distances=MissionDistances(earthKm=_norm_km(position), moonKm=130000.0),
        missionElapsedTime="0-00:00:00",
        globalCoordinates=MissionCoordinates(x=position.x, y=position.z, z=position.y),
        missionCoordinates=MissionCoordinates(x=position.x, y=position.y, z=position.z),
        sceneCoordinates=MissionCoordinates(x=position.x, y=position.z, z=position.y)
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
    else:
        state.scene_coordinates = derive_scene_coordinates(
            state.position,
            state.velocity,
            input_frame=input_frame,
        )
        state.distances = MissionDistances(earthKm=_norm_km(state.position), moonKm=state.distances.moon_km)
    return state

def get_replay_state(timestamp: str) -> MissionStateResponse:
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
        phase=MissionPhase.TRANSLUNAR_COAST,
        source=MissionDataSource.ARCHIVE,
        sourceTimestamp=timestamp,
        stalenessSeconds=0.0,
        position=position,
        velocity=velocity,
        distances=MissionDistances(earthKm=_norm_km(position), moonKm=130000.0),
        missionElapsedTime="2-04:30:15",
        globalCoordinates=MissionCoordinates(x=position.x, y=position.z, z=position.y),
        missionCoordinates=MissionCoordinates(x=position.x, y=position.y, z=position.z),
        sceneCoordinates=MissionCoordinates(x=position.x, y=position.z, z=position.y)
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
    else:
        state.distances = MissionDistances(earthKm=_norm_km(state.position), moonKm=state.distances.moon_km)
        
    return state

def get_mission_trajectory() -> MissionTrajectoryResponse:
    """
    Returns the mission trajectory, past and planned points.
    OEM is the primary source for Orion trajectory when available.
    """
    past_points = []
    planned_points = []

    ephemeris = mission_oem_service.get_ephemeris()
    if ephemeris and ephemeris.states:
        split_dt = datetime.now(timezone.utc)
        states = mission_oem_service.get_states_between(
            ephemeris.metadata.start_time,
            ephemeris.metadata.stop_time,
            max_points=120,
        )

        for state in states:
            segment = (
                MissionTrajectorySegment.PAST
                if state.dt <= split_dt
                else MissionTrajectorySegment.PLANNED
            )
            phase = (
                MissionPhase.TRANSLUNAR_COAST
                if state.dt <= split_dt
                else MissionPhase.LUNAR_FLYBY
            )
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
                    MissionPhase.TRANSLUNAR_COAST,
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
                    MissionPhase.LUNAR_FLYBY,
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
