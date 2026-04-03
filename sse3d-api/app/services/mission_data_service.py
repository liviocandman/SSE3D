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
from app.services.mission_geometry_service import enrich_mission_geometry, transform_to_eclipj2000, to_scene_frame

arow_client = AROWClient()
cache_service = MissionCacheService()

ARTEMIS2_ID = "artemis-2"
ORION_VEHICLE_ID = "orion"

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
        
        # 4. Enrich with Geometry (SPICE)
        geo_data = compute_mission_relative_geometry(live_state.source_timestamp)
        if geo_data:
            global_coords, mission_coords, distances = enrich_mission_geometry(
                orion_pos=live_state.position,
                orion_vel=live_state.velocity,
                earth_pos_eclip=geo_data["earth_pos"],
                moon_pos_eclip=geo_data["moon_pos"],
                et=geo_data["et"],
                input_frame=settings.arow_input_frame
            )
            
            live_state.global_coordinates = global_coords
            live_state.mission_coordinates = mission_coords
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
    # Basic fallback mock for ultimate failure
    now = datetime.now(timezone.utc).isoformat()
    return MissionStateResponse(
        missionId=ARTEMIS2_ID,
        vehicleId=ORION_VEHICLE_ID,
        mode="predicted",
        phase=MissionPhase.TRANSLUNAR_COAST,
        source=MissionDataSource.SPICE_PREDICTED,
        sourceTimestamp=now,
        stalenessSeconds=999.9,
        position=MissionPosition(x=150000.0, y=200000.0, z=50000.0),
        velocity=MissionVelocity(x=1.2, y=-0.5, z=0.1),
        distances=MissionDistances(earthKm=250000.0, moonKm=130000.0),
        missionElapsedTime="0-00:00:00",
        globalCoordinates=MissionCoordinates(x=150000.0, y=50000.0, z=200000.0),
        missionCoordinates=MissionCoordinates(x=150000.0, y=200000.0, z=50000.0)
    )

def get_replay_state(timestamp: str) -> MissionStateResponse:
    state = MissionStateResponse(
        missionId=ARTEMIS2_ID,
        vehicleId=ORION_VEHICLE_ID,
        mode="replay",
        phase=MissionPhase.TRANSLUNAR_COAST,
        source=MissionDataSource.ARCHIVE,
        sourceTimestamp=timestamp,
        stalenessSeconds=0.0,
        position=MissionPosition(x=150000.0, y=200000.0, z=50000.0),
        velocity=MissionVelocity(x=1.2, y=-0.5, z=0.1),
        distances=MissionDistances(earthKm=250000.0, moonKm=130000.0),
        missionElapsedTime="2-04:30:15",
        globalCoordinates=MissionCoordinates(x=150000.0, y=50000.0, z=200000.0),
        missionCoordinates=MissionCoordinates(x=150000.0, y=200000.0, z=50000.0)
    )
    
    # Enrich replay with proper SPICE geometry if available
    geo_data = compute_mission_relative_geometry(timestamp)
    if geo_data:
        global_coords, mission_coords, distances = enrich_mission_geometry(
            orion_pos=state.position,
            orion_vel=state.velocity,
            earth_pos_eclip=geo_data["earth_pos"],
            moon_pos_eclip=geo_data["moon_pos"],
            et=geo_data["et"],
            input_frame=settings.arow_input_frame
        )
        state.global_coordinates = global_coords
        state.mission_coordinates = mission_coords
        state.distances = distances
        
    return state

def get_mission_trajectory() -> MissionTrajectoryResponse:
    """
    Returns the mission trajectory, past and planned points.
    In Epic 2, we return mocked trajectory enriched with SPICE logic if possible.
    """
    past_points = []
    planned_points = []
    
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
        global_start, _, _ = enrich_mission_geometry(
            orion_start, orion_vel_start, earth_pos_start, moon_pos_start, et_start, input_frame
        )
        rotated_start_pos, rotated_start_vel = transform_to_eclipj2000(
            orion_start, orion_vel_start, input_frame, et_start
        )
        _, scene_vel_start = to_scene_frame(rotated_start_pos, rotated_start_vel)
        scene_pos_start = MissionPosition(x=global_start.x, y=global_start.y, z=global_start.z)
        
        # Enrich the end point
        global_end, _, _ = enrich_mission_geometry(
            orion_end, orion_vel_end, earth_pos_end, moon_pos_end, et_end, input_frame
        )
        rotated_end_pos, rotated_end_vel = transform_to_eclipj2000(
            orion_end, orion_vel_end, input_frame, et_end
        )
        _, scene_vel_end = to_scene_frame(rotated_end_pos, rotated_end_vel)
        scene_pos_end = MissionPosition(x=global_end.x, y=global_end.y, z=global_end.z)
        
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
