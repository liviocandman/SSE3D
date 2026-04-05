import numpy as np

from app.models.mission_schemas import MissionPosition, MissionVelocity
from app.services import mission_data_service


def test_replay_prefers_oem_geometry(monkeypatch):
    monkeypatch.setattr(
        mission_data_service,
        "_resolve_orion_state_from_oem",
        lambda _timestamp: {
            "position": MissionPosition(x=1.0, y=2.0, z=3.0),
            "velocity": MissionVelocity(x=0.1, y=0.2, z=0.3),
            "input_frame": "EME2000",
            "input_origin": "EARTH",
        },
    )
    monkeypatch.setattr(
        mission_data_service,
        "compute_mission_relative_geometry",
        lambda _timestamp: None,
    )

    state = mission_data_service.get_replay_state("2026-04-03T13:07:09Z")

    assert state.position.x == 1.0
    assert state.position.y == 2.0
    assert state.position.z == 3.0
    assert state.velocity.x == 0.1
    assert state.source.value == "ARCHIVE"


def test_replay_without_spice_keeps_earth_distance_consistent(monkeypatch):
    monkeypatch.setattr(
        mission_data_service,
        "_resolve_orion_state_from_oem",
        lambda _timestamp: {
            "position": MissionPosition(x=3.0, y=4.0, z=12.0),
            "velocity": MissionVelocity(x=0.0, y=0.0, z=0.0),
            "input_frame": "EME2000",
            "input_origin": "EARTH",
        },
    )
    monkeypatch.setattr(
        mission_data_service,
        "compute_mission_relative_geometry",
        lambda _timestamp: None,
    )

    state = mission_data_service.get_replay_state("2026-04-03T13:07:09Z")

    assert state.distances.earth_km == 13.0


def test_replay_without_spice_uses_right_handed_scene_fallback(monkeypatch):
    monkeypatch.setattr(
        mission_data_service,
        "_resolve_orion_state_from_oem",
        lambda _timestamp: {
            "position": MissionPosition(x=10.0, y=20.0, z=30.0),
            "velocity": MissionVelocity(x=0.0, y=0.0, z=0.0),
            "input_frame": "UNKNOWN_FRAME",
            "input_origin": "EARTH",
        },
    )
    monkeypatch.setattr(
        mission_data_service,
        "compute_mission_relative_geometry",
        lambda _timestamp: None,
    )

    state = mission_data_service.get_replay_state("2026-04-03T13:07:09Z")

    assert state.global_coordinates.x == 10.0
    assert state.global_coordinates.y == 30.0
    assert state.global_coordinates.z == -20.0
    assert state.scene_coordinates.x == 10.0
    assert state.scene_coordinates.y == 30.0
    assert state.scene_coordinates.z == -20.0


def test_replay_with_geometry_adds_solar_range_and_los(monkeypatch):
    monkeypatch.setattr(
        mission_data_service,
        "_resolve_orion_state_from_oem",
        lambda _timestamp: {
            "position": MissionPosition(x=3000.0, y=0.0, z=0.0),
            "velocity": MissionVelocity(x=1.0, y=0.0, z=0.0),
            "input_frame": "UNKNOWN_FRAME",
            "input_origin": "EARTH",
        },
    )
    monkeypatch.setattr(
        mission_data_service,
        "compute_mission_relative_geometry",
        lambda _timestamp: {
            "et": 0.0,
            "earth_pos": np.array([100.0, 0.0, 0.0]),
            "moon_pos": np.array([900.0, 0.0, 0.0]),
        },
    )

    state = mission_data_service.get_replay_state("2026-04-03T13:07:09Z")

    assert state.solar_range_km == 3100.0
    assert state.line_of_sight_status.value == "lunar_occultation"


def test_replay_exposes_attitude_metadata(monkeypatch):
    monkeypatch.setattr(
        mission_data_service,
        "_resolve_orion_state_from_oem",
        lambda _timestamp: {
            "position": MissionPosition(x=1000.0, y=0.0, z=0.0),
            "velocity": MissionVelocity(x=0.0, y=1.0, z=0.0),
            "input_frame": "EME2000",
            "input_origin": "EARTH",
        },
    )
    monkeypatch.setattr(
        mission_data_service,
        "compute_mission_relative_geometry",
        lambda _timestamp: None,
    )

    state = mission_data_service.get_replay_state("2026-04-03T13:07:09Z")

    assert state.attitude_quaternion is not None
    assert state.inertial_attitude_quaternion is not None
    assert state.lvlh_attitude_quaternion is not None
    assert state.attitude_source.value == "POLICY_ESTIMATED"
    assert state.attitude_mode.value == "TAIL_TO_SUN"
    assert state.reference_frame.value == "ECLIPJ2000"
    assert state.attitude_confidence > 0.0
