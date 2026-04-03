import numpy as np
from app.models.mission_schemas import MissionPosition, MissionVelocity
from app.services.mission_data_service import _build_earth_relative_predicted_position
from app.services.mission_geometry_service import (
    transform_to_eclipj2000,
    calculate_mission_local_frame,
    enrich_mission_geometry,
    to_scene_frame,
    derive_scene_coordinates,
    normalize_spice_frame,
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


def test_normalize_spice_frame_maps_eme2000_to_j2000():
    assert normalize_spice_frame("EME2000") == "J2000"
    assert normalize_spice_frame("J2000") == "J2000"


def test_transform_to_eclipj2000_uses_normalized_frame_alias(monkeypatch):
    pos = MissionPosition(x=10.0, y=20.0, z=30.0)
    vel = MissionVelocity(x=1.0, y=2.0, z=3.0)
    captured = {}

    def fake_pxform(source, target, et):
        captured["source"] = source
        captured["target"] = target
        return np.identity(3)

    monkeypatch.setattr("app.services.mission_geometry_service.spice.pxform", fake_pxform)

    out_pos, out_vel = transform_to_eclipj2000(pos, vel, "EME2000", et=123.0)

    assert captured["source"] == "J2000"
    assert captured["target"] == "ECLIPJ2000"
    assert out_pos.x == 10.0
    assert out_vel.z == 3.0

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
    
    global_coords, mission_coords, scene_coords, distances = enrich_mission_geometry(pos, vel, earth, moon, et=0.0, input_frame="ECLIPJ2000")
    
    assert global_coords.x == 100000.0
    assert global_coords.y == 0.0
    assert global_coords.z == 0.0
    
    assert mission_coords.x == 100000.0
    
    assert np.isclose(distances.earth_km, 100000.0)
    assert np.isclose(distances.moon_km, 200000.0)

def test_enrich_mission_geometry_offsets_earth_centered_telemetry_into_global_frame():
    pos = MissionPosition(x=100000.0, y=20000.0, z=30000.0)
    vel = MissionVelocity(x=1.0, y=0.0, z=0.0)
    earth = np.array([149_600_000.0, 0.0, 0.0])
    moon = np.array([149_984_400.0, 0.0, 0.0])

    global_coords, mission_coords, scene_coords, distances = enrich_mission_geometry(
        pos,
        vel,
        earth,
        moon,
        et=0.0,
        input_frame="ECLIPJ2000",
        input_origin="EARTH",
    )

    # Global scene coordinates should include Earth's heliocentric offset.
    assert np.isclose(global_coords.x, 149_700_000.0)
    assert np.isclose(global_coords.y, 30000.0)
    assert np.isclose(global_coords.z, 20000.0)

    # Mission-local coordinates remain Earth-centered in meaning.
    assert np.isclose(mission_coords.x, 100000.0)
    assert np.isclose(distances.earth_km, np.linalg.norm([100000.0, 20000.0, 30000.0]))
    assert distances.moon_km > distances.earth_km

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


def test_derive_scene_coordinates_keeps_orion_earth_relative():
    pos = MissionPosition(x=100000.0, y=20000.0, z=30000.0)
    vel = MissionVelocity(x=1.0, y=0.0, z=0.0)

    scene_coords = derive_scene_coordinates(
        pos,
        vel,
        input_frame="ECLIPJ2000",
        et=0.0,
    )

    # The render-space coordinate remains Earth-relative and only applies
    # the scene-axis remapping used elsewhere in the project.
    assert scene_coords.x == 100000.0
    assert scene_coords.y == 30000.0
    assert scene_coords.z == 20000.0


def test_predicted_fallback_position_aligns_with_earth_moon_direction(monkeypatch):
    mocked_geo = {
        "earth_pos": np.array([10.0, 0.0, 0.0]),
        "moon_pos": np.array([410.0, 0.0, 0.0]),
        "et": 0.0,
    }

    monkeypatch.setattr(
        "app.services.mission_data_service.compute_mission_relative_geometry",
        lambda _timestamp: mocked_geo,
    )

    position, _velocity, geo_data = _build_earth_relative_predicted_position("2026-04-03T12:00:00Z")

    assert geo_data is mocked_geo

    moon_relative = geo_data["moon_pos"] - geo_data["earth_pos"]
    orion_relative = np.array([position.x, position.y, position.z])

    moon_unit = moon_relative / np.linalg.norm(moon_relative)
    orion_unit = orion_relative / np.linalg.norm(orion_relative)

    # The predicted fallback should sit on the Earth->Moon transfer axis,
    # not on an arbitrary vector disconnected from the Moon's current geometry.
    assert np.allclose(orion_unit, moon_unit, atol=1e-6)
