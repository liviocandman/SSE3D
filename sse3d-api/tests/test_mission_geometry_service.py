import pytest
import numpy as np
from app.models.mission_schemas import MissionPosition, MissionVelocity
from app.services.mission_geometry_service import (
    transform_to_eclipj2000,
    calculate_mission_local_frame,
    enrich_mission_geometry,
    to_scene_frame,
)

def test_transform_to_eclipj2000():
    pos = MissionPosition(x=100.0, y=200.0, z=300.0)
    vel = MissionVelocity(x=1.0, y=2.0, z=3.0)
    
    # ECLIPJ2000 to ECLIPJ2000 should be identity
    out_pos, out_vel = transform_to_eclipj2000(pos, vel, "ECLIPJ2000", et=0.0)
    assert out_pos.x == 100.0
    assert out_pos.y == 200.0
    assert out_pos.z == 300.0
    assert out_vel.x == 1.0
    assert out_vel.y == 2.0
    assert out_vel.z == 3.0

def test_transform_preserves_magnitude_fallback():
    pos = MissionPosition(x=100.0, y=200.0, z=300.0)
    vel = MissionVelocity(x=1.0, y=2.0, z=3.0)
    
    # Fake frame that SPICE doesn't know without kernels will trigger exception,
    # and the fallback is identity, which preserves magnitude
    out_pos, out_vel = transform_to_eclipj2000(pos, vel, "UNKNOWN_FRAME", et=0.0)
    assert out_pos.x == 100.0

def test_calculate_mission_local_frame():
    # Simple scenario: Earth at origin, Moon on +X
    earth = np.array([0.0, 0.0, 0.0])
    moon = np.array([300000.0, 0.0, 0.0])
    
    # Orion at some offset
    orion = np.array([100000.0, 50000.0, 10000.0])
    
    local = calculate_mission_local_frame(orion, earth, moon)
    
    # Given the construction: X is +X. Ref_up is +Z. 
    # Y = ref_up x X = (0,0,1) x (1,0,0) = (0,1,0)
    # Z = X x Y = (1,0,0) x (0,1,0) = (0,0,1)
    # The matrix is Identity.
    assert np.isclose(local.x, 100000.0)
    assert np.isclose(local.y, 50000.0)
    assert np.isclose(local.z, 10000.0)

def test_enrich_mission_geometry():
    pos = MissionPosition(x=100000.0, y=0.0, z=0.0)
    vel = MissionVelocity(x=1.0, y=0.0, z=0.0)
    earth = np.array([0.0, 0.0, 0.0])
    moon = np.array([300000.0, 0.0, 0.0])
    
    global_coords, mission_coords, distances = enrich_mission_geometry(pos, vel, earth, moon, et=0.0, input_frame="ECLIPJ2000")
    
    assert global_coords.x == 100000.0
    assert global_coords.y == 0.0
    assert global_coords.z == 0.0
    
    assert mission_coords.x == 100000.0
    
    assert np.isclose(distances.earth_km, 100000.0)
    assert np.isclose(distances.moon_km, 200000.0)

def test_to_scene_frame_swaps_yz_axes():
    pos = MissionPosition(x=10.0, y=20.0, z=30.0)
    vel = MissionVelocity(x=1.0, y=2.0, z=3.0)
    scene_pos, scene_vel = to_scene_frame(pos, vel)

    assert scene_pos.x == 10.0
    assert scene_pos.y == 30.0
    assert scene_pos.z == 20.0
    assert scene_vel.x == 1.0
    assert scene_vel.y == 3.0
    assert scene_vel.z == 2.0
