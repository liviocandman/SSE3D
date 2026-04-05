import numpy as np
import spiceypy as spice
from typing import Optional, Tuple
from loguru import logger
from app.models.mission_schemas import (
    MissionAttitudeFrame,
    MissionAttitudeMode,
    MissionAttitudeSource,
    MissionCoordinates,
    MissionDistances,
    MissionPhase,
    MissionPosition,
    MissionQuaternion,
    MissionVelocity,
)
from app.services.mission_attitude_service import compute_policy_attitude_rotation


FRAME_ALIASES = {
    "EME2000": "J2000",
}

CK_FRAME_CANDIDATES = (
    "ORION_SC_BODY",
    "ORION_SPACECRAFT",
    "ORION_MPCV",
    "ORION",
)


def normalize_spice_frame(frame_name: str) -> str:
    """
    Normalizes common mission telemetry frame aliases to SPICE-native frame names.

    NASA/OEM products may expose `EME2000`, while SPICE inertial transforms
    are typically defined against `J2000`. Treating the alias explicitly avoids
    silently falling back to identity and leaking Earth's equatorial tilt into
    the frontend scene.
    """
    normalized = frame_name.upper()
    return FRAME_ALIASES.get(normalized, normalized)


def _normalize(vec: np.ndarray, fallback: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    if norm <= 1e-9:
        return fallback
    return vec / norm


def _rotation_matrix_to_quaternion_xyzw(rot_matrix: np.ndarray) -> MissionQuaternion:
    """Converts a 3x3 rotation matrix to an XYZW quaternion."""
    m = rot_matrix
    trace = float(m[0, 0] + m[1, 1] + m[2, 2])

    if trace > 0.0:
        s = (trace + 1.0) ** 0.5 * 2.0
        w = 0.25 * s
        x = (m[2, 1] - m[1, 2]) / s
        y = (m[0, 2] - m[2, 0]) / s
        z = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = (1.0 + m[0, 0] - m[1, 1] - m[2, 2]) ** 0.5 * 2.0
        w = (m[2, 1] - m[1, 2]) / s
        x = 0.25 * s
        y = (m[0, 1] + m[1, 0]) / s
        z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = (1.0 + m[1, 1] - m[0, 0] - m[2, 2]) ** 0.5 * 2.0
        w = (m[0, 2] - m[2, 0]) / s
        x = (m[0, 1] + m[1, 0]) / s
        y = 0.25 * s
        z = (m[1, 2] + m[2, 1]) / s
    else:
        s = (1.0 + m[2, 2] - m[0, 0] - m[1, 1]) ** 0.5 * 2.0
        w = (m[1, 0] - m[0, 1]) / s
        x = (m[0, 2] + m[2, 0]) / s
        y = (m[1, 2] + m[2, 1]) / s
        z = 0.25 * s

    quat = np.array([x, y, z, w], dtype=float)
    quat /= max(float(np.linalg.norm(quat)), 1e-9)
    return MissionQuaternion(x=float(quat[0]), y=float(quat[1]), z=float(quat[2]), w=float(quat[3]))


def _build_rotation_from_prograde_nadir(
    prograde_vec: np.ndarray,
    nadir_vec: np.ndarray,
) -> np.ndarray:
    x_axis = _normalize(prograde_vec, np.array([1.0, 0.0, 0.0], dtype=float))
    z_axis = _normalize(nadir_vec, np.array([0.0, 0.0, 1.0], dtype=float))

    y_axis = np.cross(x_axis, z_axis)
    if float(np.linalg.norm(y_axis)) <= 1e-9:
        fallback_up = np.array([0.0, 0.0, 1.0], dtype=float)
        y_axis = np.cross(x_axis, fallback_up)
    y_axis = _normalize(y_axis, np.array([0.0, 1.0, 0.0], dtype=float))

    # Re-orthogonalize Z so the triad remains right-handed and numerically stable.
    z_axis = _normalize(np.cross(y_axis, x_axis), np.array([0.0, 0.0, 1.0], dtype=float))

    # Columns are body axes in world coordinates: body->world rotation.
    return np.column_stack((x_axis, y_axis, z_axis))


def _mission_local_basis(earth_pos_eclip: np.ndarray, moon_pos_eclip: np.ndarray) -> np.ndarray:
    earth_to_moon = moon_pos_eclip - earth_pos_eclip
    x_axis = _normalize(earth_to_moon, np.array([1.0, 0.0, 0.0], dtype=float))

    ref_up = np.array([0.0, 0.0, 1.0], dtype=float)
    y_axis = np.cross(ref_up, x_axis)
    if float(np.linalg.norm(y_axis)) <= 1e-9:
        ref_up = np.array([0.0, 1.0, 0.0], dtype=float)
        y_axis = np.cross(ref_up, x_axis)
    y_axis = _normalize(y_axis, np.array([0.0, 1.0, 0.0], dtype=float))

    z_axis = _normalize(np.cross(x_axis, y_axis), np.array([0.0, 0.0, 1.0], dtype=float))
    return np.column_stack((x_axis, y_axis, z_axis))


def _to_scene_vector(vec: np.ndarray) -> np.ndarray:
    return np.array([vec[0], vec[2], -vec[1]], dtype=float)


def _try_ck_body_to_inertial(et: float) -> Optional[np.ndarray]:
    for frame_name in CK_FRAME_CANDIDATES:
        try:
            frame_code = spice.namfrm(frame_name)
            if frame_code == 0:
                continue
            rot = spice.pxform(frame_name, "ECLIPJ2000", et)
            logger.debug(f"Mission attitude CK frame resolved: {frame_name}")
            return np.array(rot, dtype=float)
        except Exception:
            continue
    return None

def transform_to_eclipj2000(
    position: MissionPosition, 
    velocity: MissionVelocity, 
    input_frame: str, 
    et: float
) -> Tuple[MissionPosition, MissionVelocity]:
    """
    Transforms coordinates from a given input_frame to ECLIPJ2000.
    """
    source_frame = normalize_spice_frame(input_frame)

    if source_frame == "ECLIPJ2000":
        return position, velocity
        
    try:
        rot_matrix = spice.pxform(source_frame, "ECLIPJ2000", et)
        
        pos_vec = np.array([position.x, position.y, position.z])
        vel_vec = np.array([velocity.x, velocity.y, velocity.z])
        
        new_pos = rot_matrix @ pos_vec
        new_vel = rot_matrix @ vel_vec
        
        # Log preservation of magnitude (Epic 2 validation criteria)
        logger.debug(f"Rotated position from {source_frame} to ECLIPJ2000 at ET={et}")
        
        return (
            MissionPosition(x=float(new_pos[0]), y=float(new_pos[1]), z=float(new_pos[2])),
            MissionVelocity(x=float(new_vel[0]), y=float(new_vel[1]), z=float(new_vel[2]))
        )
    except Exception as e:
        logger.error(f"Failed to transform frame {source_frame} to ECLIPJ2000: {e}")
        # fallback to identity
        return position, velocity


def to_scene_frame(
    position: MissionPosition,
    velocity: MissionVelocity,
) -> Tuple[MissionPosition, MissionVelocity]:
    """
    Maps ECLIPJ2000 coordinates into the project's scene frame.
    Target convention: (x, y, z) -> (x, z, -y) for Right-Handed system.
    """
    return (
        MissionPosition(x=position.x, y=position.z, z=-position.y),
        MissionVelocity(x=velocity.x, y=velocity.z, z=-velocity.y),
    )


def derive_scene_coordinates(
    position: MissionPosition,
    velocity: MissionVelocity,
    input_frame: str = "J2000",
    et: float = 0.0,
) -> MissionCoordinates:
    """
    Converts an Earth-relative telemetry vector into the project's scene frame.

    This is the single render-space coordinate the frontend should use for Orion.
    It does not apply Earth's heliocentric offset; it only rotates the incoming
    telemetry frame into ECLIPJ2000 when needed and then maps axes into the
    scene convention used by planets/moons.
    """
    rotated_pos, rotated_vel = transform_to_eclipj2000(position, velocity, input_frame, et)
    scene_pos, _ = to_scene_frame(rotated_pos, rotated_vel)
    return MissionCoordinates(x=float(scene_pos.x), y=float(scene_pos.y), z=float(scene_pos.z))

def calculate_mission_local_frame(
    orion_eclip: np.ndarray,
    earth_eclip: np.ndarray,
    moon_eclip: np.ndarray
) -> MissionCoordinates:
    """
    Returns Orion's coordinates in a mission-local frame centered on Earth.
    +X: Earth to Moon direction
    +Y: derived to complete the right-handed system
    +Z: Orthogonal component derived from local orbital plane (Earth-Moon plane)
    
    Uses ecliptic Z (0, 0, 1) as reference up to determine Y, then cross product for local Z.
    """
    earth_to_moon = moon_eclip - earth_eclip
    norm_earth_to_moon = np.linalg.norm(earth_to_moon)
    
    if norm_earth_to_moon == 0:
        x_axis = np.array([1.0, 0.0, 0.0])
    else:
        x_axis = earth_to_moon / norm_earth_to_moon
        
    ref_up = np.array([0.0, 0.0, 1.0])
    
    y_axis = np.cross(ref_up, x_axis)
    norm_y = np.linalg.norm(y_axis)
    if norm_y == 0:
        ref_up = np.array([0.0, 1.0, 0.0])
        y_axis = np.cross(ref_up, x_axis)
        norm_y = np.linalg.norm(y_axis)
        
    y_axis = y_axis / norm_y
    
    z_axis = np.cross(x_axis, y_axis)
    z_axis = z_axis / np.linalg.norm(z_axis)
    
    # Transformation matrix from global to local
    # Vectors are row vectors in rot_matrix, so multiplication is rot_matrix @ vec
    rot_matrix = np.vstack([x_axis, y_axis, z_axis])
    
    orion_relative_to_earth = orion_eclip - earth_eclip
    
    local_pos = rot_matrix @ orion_relative_to_earth
    return MissionCoordinates(x=float(local_pos[0]), y=float(local_pos[1]), z=float(local_pos[2]))

def enrich_mission_geometry(
    orion_pos: MissionPosition,
    orion_vel: MissionVelocity,
    earth_pos_eclip: np.ndarray,
    moon_pos_eclip: np.ndarray,
    et: float,
    input_frame: str = "J2000",
    input_origin: str = "EARTH",
) -> Tuple[MissionCoordinates, MissionCoordinates, MissionCoordinates, MissionDistances]:
    """
    Enriches the raw Orion state with global coordinates, mission-local coordinates, Earth-relative scene coordinates, and derived distances.
    """
    relative_pos_eclip, relative_vel_eclip = transform_to_eclipj2000(orion_pos, orion_vel, input_frame, et)
    relative_orion_eclip = np.array([relative_pos_eclip.x, relative_pos_eclip.y, relative_pos_eclip.z])

    # AROW telemetry is treated as Earth-centered by default. Convert it into the
    # solar-system global frame before mapping it into the scene.
    if input_origin.upper() == "EARTH":
        earth_relative_eclip = relative_orion_eclip
        orion_eclip = earth_pos_eclip + relative_orion_eclip
        earth_dist = float(np.linalg.norm(relative_orion_eclip))
    else:
        earth_relative_eclip = relative_orion_eclip - earth_pos_eclip
        orion_eclip = relative_orion_eclip
        earth_dist = float(np.linalg.norm(earth_relative_eclip))

    global_pos_eclip = MissionPosition(
        x=float(orion_eclip[0]),
        y=float(orion_eclip[1]),
        z=float(orion_eclip[2]),
    )
    scene_pos, _scene_vel = to_scene_frame(global_pos_eclip, relative_vel_eclip)

    global_coords = MissionCoordinates(
        x=float(scene_pos.x),
        y=float(scene_pos.y),
        z=float(scene_pos.z),
    )
    
    # Earth relative scene coordinates
    earth_rel_pos_eclip = MissionPosition(
        x=float(earth_relative_eclip[0]),
        y=float(earth_relative_eclip[1]),
        z=float(earth_relative_eclip[2]),
    )
    scene_coords = derive_scene_coordinates(
        earth_rel_pos_eclip,
        relative_vel_eclip,
        input_frame="ECLIPJ2000",
        et=et,
    )
    
    mission_coords = calculate_mission_local_frame(orion_eclip, earth_pos_eclip, moon_pos_eclip)
    
    moon_dist = float(np.linalg.norm(orion_eclip - moon_pos_eclip))
    
    distances = MissionDistances(earthKm=earth_dist, moonKm=moon_dist)
    
    return global_coords, mission_coords, scene_coords, distances


def compute_mission_attitude(
    *,
    orion_pos: MissionPosition,
    orion_vel: MissionVelocity,
    phase: MissionPhase,
    input_frame: str,
    input_origin: str,
    et: float,
    earth_pos_eclip: Optional[np.ndarray] = None,
    moon_pos_eclip: Optional[np.ndarray] = None,
) -> dict:
    """
    Computes Orion attitude with source priority:
    1) CK/SPICE frame transform if available and valid.
    2) Geometric fallback using prograde+nadir construction.

    Returns quaternions for scene rendering and explicit inertial/LVLH references.
    """
    rel_pos_eclip, rel_vel_eclip = transform_to_eclipj2000(orion_pos, orion_vel, input_frame, et)
    relative_orion = np.array([rel_pos_eclip.x, rel_pos_eclip.y, rel_pos_eclip.z], dtype=float)
    velocity_vec = np.array([rel_vel_eclip.x, rel_vel_eclip.y, rel_vel_eclip.z], dtype=float)

    if input_origin.upper() == "EARTH":
        earth_relative_orion = relative_orion
        orion_global = (earth_pos_eclip + relative_orion) if earth_pos_eclip is not None else relative_orion
    else:
        orion_global = relative_orion
        earth_relative_orion = (
            relative_orion - earth_pos_eclip
            if earth_pos_eclip is not None
            else relative_orion
        )

    body_to_eclip = _try_ck_body_to_inertial(et)
    attitude_mode = MissionAttitudeMode.HOLD
    if body_to_eclip is not None:
        attitude_source = MissionAttitudeSource.CK_SPICE
        attitude_confidence = 0.98
    else:
        earth_nadir = -earth_relative_orion
        moon_nadir = None
        if moon_pos_eclip is not None:
            moon_nadir = moon_pos_eclip - orion_global

        sun_to_orion = orion_global

        try:
            body_to_eclip, attitude_mode, attitude_confidence = compute_policy_attitude_rotation(
                phase=phase,
                et=et,
                velocity_vec=velocity_vec,
                earth_nadir_vec=earth_nadir,
                sun_to_orion_vec=sun_to_orion,
                moon_nadir_vec=moon_nadir,
            )
            attitude_source = MissionAttitudeSource.POLICY_ESTIMATED
        except Exception:
            nadir_vec = earth_nadir
            if moon_nadir is not None:
                if float(np.linalg.norm(moon_nadir)) < float(np.linalg.norm(earth_nadir)):
                    nadir_vec = moon_nadir
            body_to_eclip = _build_rotation_from_prograde_nadir(velocity_vec, nadir_vec)
            attitude_source = MissionAttitudeSource.GEOMETRIC_FALLBACK
            attitude_mode = MissionAttitudeMode.HOLD
            attitude_confidence = 0.45

    inertial_quat = _rotation_matrix_to_quaternion_xyzw(body_to_eclip)

    if earth_pos_eclip is not None and moon_pos_eclip is not None:
        lvlh_basis = _mission_local_basis(earth_pos_eclip, moon_pos_eclip)
        eclip_to_lvlh = lvlh_basis.T
        body_to_lvlh = eclip_to_lvlh @ body_to_eclip
    else:
        body_to_lvlh = np.identity(3)
    lvlh_quat = _rotation_matrix_to_quaternion_xyzw(body_to_lvlh)

    # Frontend renders in scene frame, so provide a render-ready quaternion.
    scene_axes = np.column_stack((
        _to_scene_vector(body_to_eclip[:, 0]),
        _to_scene_vector(body_to_eclip[:, 1]),
        _to_scene_vector(body_to_eclip[:, 2]),
    ))
    scene_quat = _rotation_matrix_to_quaternion_xyzw(scene_axes)

    return {
        "attitude_quaternion": scene_quat,
        "inertial_attitude_quaternion": inertial_quat,
        "lvlh_attitude_quaternion": lvlh_quat,
        "attitude_source": attitude_source,
        "attitude_mode": attitude_mode,
        "attitude_confidence": attitude_confidence,
        "reference_frame": MissionAttitudeFrame.ECLIPJ2000,
    }
