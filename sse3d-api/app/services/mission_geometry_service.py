import numpy as np
import spiceypy as spice
from typing import Tuple
from loguru import logger
from app.models.mission_schemas import MissionPosition, MissionVelocity, MissionCoordinates, MissionDistances

def transform_to_eclipj2000(
    position: MissionPosition, 
    velocity: MissionVelocity, 
    input_frame: str, 
    et: float
) -> Tuple[MissionPosition, MissionVelocity]:
    """
    Transforms coordinates from a given input_frame to ECLIPJ2000.
    """
    if input_frame.upper() == "ECLIPJ2000":
        return position, velocity
        
    try:
        rot_matrix = spice.pxform(input_frame.upper(), "ECLIPJ2000", et)
        
        pos_vec = np.array([position.x, position.y, position.z])
        vel_vec = np.array([velocity.x, velocity.y, velocity.z])
        
        new_pos = rot_matrix @ pos_vec
        new_vel = rot_matrix @ vel_vec
        
        # Log preservation of magnitude (Epic 2 validation criteria)
        logger.debug(f"Rotated position from {input_frame} to ECLIPJ2000 at ET={et}")
        
        return (
            MissionPosition(x=float(new_pos[0]), y=float(new_pos[1]), z=float(new_pos[2])),
            MissionVelocity(x=float(new_vel[0]), y=float(new_vel[1]), z=float(new_vel[2]))
        )
    except Exception as e:
        logger.error(f"Failed to transform frame {input_frame} to ECLIPJ2000: {e}")
        # fallback to identity
        return position, velocity


def to_scene_frame(
    position: MissionPosition,
    velocity: MissionVelocity,
) -> Tuple[MissionPosition, MissionVelocity]:
    """
    Maps ECLIPJ2000 coordinates into the project's scene frame.
    Mirrors the existing SPICE `_to_scene_coords` convention:
    x -> x, z -> y, y -> z.
    """
    return (
        MissionPosition(x=position.x, y=position.z, z=position.y),
        MissionVelocity(x=velocity.x, y=velocity.z, z=velocity.y),
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
