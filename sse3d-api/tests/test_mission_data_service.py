import numpy as np
from types import SimpleNamespace
from datetime import datetime, timezone

from app.models.mission_schemas import MissionPosition, MissionVelocity
from app.services import mission_data_service
from app.services.mission_oem_service import OEMStateVector


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


def test_derive_lunar_flyby_window_covers_full_moon_centered_arc(monkeypatch):
    timestamps = [
        "2026-04-05T06:00:00Z",
        "2026-04-05T07:00:00Z",
        "2026-04-05T08:00:00Z",
        "2026-04-05T09:00:00Z",
        "2026-04-05T10:00:00Z",
    ]

    states = tuple(
        OEMStateVector(
            timestamp=timestamp,
            dt=datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(timezone.utc),
            position=MissionPosition(x=300_000.0, y=0.0, z=0.0),
            velocity=MissionVelocity(x=0.0, y=1.0, z=0.0),
        )
        for timestamp in timestamps
    )
    ephemeris = SimpleNamespace(
        metadata=SimpleNamespace(
            start_time=timestamps[0],
            stop_time=timestamps[-1],
            ref_frame="EME2000",
        ),
        states=states,
    )
    moon_positions = {
        timestamps[0]: np.array([700_000.0, 0.0, 0.0], dtype=float),
        timestamps[1]: np.array([550_000.0, 0.0, 0.0], dtype=float),
        timestamps[2]: np.array([400_000.0, 0.0, 0.0], dtype=float),
        timestamps[3]: np.array([550_000.0, 0.0, 0.0], dtype=float),
        timestamps[4]: np.array([700_000.0, 0.0, 0.0], dtype=float),
    }

    monkeypatch.setattr(
        mission_data_service.mission_oem_service,
        "get_states_between",
        lambda *_args, **_kwargs: list(states),
    )
    monkeypatch.setattr(
        mission_data_service,
        "compute_mission_relative_geometry",
        lambda timestamp: {
            "et": 0.0,
            "earth_pos": np.array([0.0, 0.0, 0.0], dtype=float),
            "moon_pos": moon_positions[timestamp],
        },
    )

    start_ts, center_ts, end_ts = mission_data_service._derive_lunar_flyby_window(ephemeris)

    assert start_ts == timestamps[1]
    assert center_ts == timestamps[2]
    assert end_ts == timestamps[3]


def test_replay_uses_nose_to_moon_during_lunar_flyby_window(monkeypatch):
    monkeypatch.setattr(
        mission_data_service,
        "_resolve_orion_state_from_oem",
        lambda _timestamp: {
            "position": MissionPosition(x=300_000.0, y=0.0, z=0.0),
            "velocity": MissionVelocity(x=0.0, y=1.0, z=0.0),
            "input_frame": "EME2000",
            "input_origin": "EARTH",
        },
    )
    monkeypatch.setattr(
        mission_data_service,
        "_get_lunar_flyby_window",
        lambda _ephemeris=None: (
            "2026-04-05T07:00:00Z",
            "2026-04-05T08:00:00Z",
            "2026-04-05T09:00:00Z",
        ),
    )
    monkeypatch.setattr(
        mission_data_service,
        "compute_mission_relative_geometry",
        lambda _timestamp: {
            "et": 0.0,
            "earth_pos": np.array([0.0, 0.0, 0.0], dtype=float),
            "moon_pos": np.array([400_000.0, 0.0, 0.0], dtype=float),
        },
    )

    state = mission_data_service.get_replay_state("2026-04-05T08:00:00Z")

    assert state.phase.value == "lunar_flyby"
    assert state.attitude_source.value == "POLICY_ESTIMATED"
    assert state.attitude_mode.value == "NOSE_TO_MOON"


def test_derive_lunar_flyby_window_caps_return_transition_at_2030z(monkeypatch):
    timestamps = [
        "2026-04-05T18:00:00Z",
        "2026-04-05T19:00:00Z",
        "2026-04-05T20:00:00Z",
        "2026-04-05T20:30:00Z",
        "2026-04-05T21:00:00Z",
        "2026-04-05T22:00:00Z",
    ]

    states = tuple(
        OEMStateVector(
            timestamp=timestamp,
            dt=datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(timezone.utc),
            position=MissionPosition(x=300_000.0, y=0.0, z=0.0),
            velocity=MissionVelocity(x=0.0, y=1.0, z=0.0),
        )
        for timestamp in timestamps
    )
    ephemeris = SimpleNamespace(
        metadata=SimpleNamespace(
            start_time=timestamps[0],
            stop_time=timestamps[-1],
            ref_frame="EME2000",
        ),
        states=states,
    )
    moon_positions = {
        timestamps[0]: np.array([520_000.0, 0.0, 0.0], dtype=float),
        timestamps[1]: np.array([450_000.0, 0.0, 0.0], dtype=float),
        timestamps[2]: np.array([350_000.0, 0.0, 0.0], dtype=float),
        timestamps[3]: np.array([360_000.0, 0.0, 0.0], dtype=float),
        timestamps[4]: np.array([380_000.0, 0.0, 0.0], dtype=float),
        timestamps[5]: np.array([410_000.0, 0.0, 0.0], dtype=float),
    }

    monkeypatch.setattr(
        mission_data_service.mission_oem_service,
        "get_states_between",
        lambda *_args, **_kwargs: list(states),
    )
    monkeypatch.setattr(
        mission_data_service,
        "compute_mission_relative_geometry",
        lambda timestamp: {
            "et": 0.0,
            "earth_pos": np.array([0.0, 0.0, 0.0], dtype=float),
            "moon_pos": moon_positions[timestamp],
        },
    )

    start_ts, center_ts, end_ts = mission_data_service._derive_lunar_flyby_window(ephemeris)

    assert start_ts == timestamps[0]
    assert center_ts == timestamps[2]
    assert end_ts == "2026-04-05T20:30:00Z"


def test_lunar_return_transition_is_timezone_safe():
    reference_dt = mission_data_service._parse_split_timestamp("2026-04-05T17:00:00-03:00")
    transition_dt = mission_data_service._resolve_lunar_return_coast_start(reference_dt)

    assert mission_data_service._format_iso_z(transition_dt) == "2026-04-05T20:30:00Z"


def test_fallback_lunar_window_normalizes_offset_timestamp_to_utc():
    start_ts, center_ts, end_ts = mission_data_service._fallback_lunar_flyby_window("2026-04-05T05:00:00-03:00")

    assert start_ts == "2026-04-05T02:00:00Z"
    assert center_ts == "2026-04-05T08:00:00Z"
    assert end_ts == "2026-04-05T20:30:00Z"
