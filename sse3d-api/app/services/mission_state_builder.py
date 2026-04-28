import numpy as np
from app.models.mission_schemas import MissionStateResponse, MissionLineOfSightStatus, MissionPosition, MissionVelocity
from app.services.mission_geometry_service import (
    compute_mission_attitude,
    enrich_mission_geometry,
    transform_to_eclipj2000,
    derive_scene_coordinates,
)
from app.services.spice_engine import compute_mission_relative_geometry
from app.services.mission_oem_service import mission_oem_service

MOON_MEAN_RADIUS_KM = 1_737.4
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

def _build_earth_relative_predicted_position(timestamp: str):
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

def build_base_mission_state(timestamp: str, mode: str, source: str, staleness: float, get_mission_events_func) -> MissionStateResponse:
    from app.services.mission_event_service import format_mission_elapsed_time
    from app.models.mission_schemas import MissionCoordinates, MissionDistances
    from app.core.config import settings
    ARTEMIS2_ID = "artemis-2"
    ORION_VEHICLE_ID = "orion"

    phase = get_mission_events_func(timestamp).current_phase
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
        mode=mode,
        phase=phase,
        source=source,
        sourceTimestamp=timestamp,
        stalenessSeconds=staleness,
        position=position,
        velocity=velocity,
        distances=MissionDistances(earthKm=_norm_km(position), moonKm=130000.0),
        missionElapsedTime=format_mission_elapsed_time(timestamp),
        globalCoordinates=MissionCoordinates(x=position.x, y=position.z, z=-position.y),
        missionCoordinates=MissionCoordinates(x=position.x, y=position.y, z=position.z),
        sceneCoordinates=MissionCoordinates(x=position.x, y=position.z, z=-position.y)
    )
    enrich_state_with_geometry(state, geo_data, input_frame, input_origin)
    return state

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
    phase,
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

def enrich_state_with_geometry(state: MissionStateResponse, geo_data: dict | None, input_frame: str, input_origin: str) -> None:
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
        if hasattr(state, "distances") and state.distances:
            state.distances.earth_km = _norm_km(state.position)
            
    context = _compute_spacecraft_context(
        phase=state.phase,
        position=state.position,
        velocity=state.velocity,
        input_frame=input_frame,
        input_origin=input_origin,
        geo_data=geo_data,
    )
    _apply_spacecraft_context(state, context)
