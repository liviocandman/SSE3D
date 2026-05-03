import numpy as np

from app.services import spice_engine
from app.services.spice_engine import _to_scene_coords


def test_to_scene_coords_uses_right_handed_mapping():
    scene = _to_scene_coords(np.array([10.0, 20.0, 30.0]))

    assert scene["x"] == 10.0
    assert scene["y"] == 30.0
    assert scene["z"] == -20.0


def test_to_scene_coords_preserves_handedness_for_basis_vectors():
    x_axis = _to_scene_coords(np.array([1.0, 0.0, 0.0]))
    y_axis = _to_scene_coords(np.array([0.0, 1.0, 0.0]))
    z_axis = _to_scene_coords(np.array([0.0, 0.0, 1.0]))

    # Canonical mapping:
    # X -> X
    # Y -> -Z
    # Z -> Y
    assert x_axis == {"x": 1.0, "y": 0.0, "z": -0.0}
    assert y_axis == {"x": 0.0, "y": 0.0, "z": -1.0}
    assert z_axis == {"x": 0.0, "y": 1.0, "z": -0.0}


def test_compute_mission_relative_geometry_batch_uses_vectorized_spkezr(monkeypatch):
    calls = []
    et_by_timestamp = {
        "2026-04-03T12:00:00": 1.0,
        "2026-04-03T12:01:00": 2.0,
    }

    def fake_spkezr(target, ets, frame, abcorr, observer):
        et_values = np.asarray(ets, dtype=float)
        calls.append((target, et_values.tolist(), frame, abcorr, observer))
        offset = 100.0 if target == "399" else 300.0
        states = np.array(
            [
                [offset + et, offset + et + 1.0, offset + et + 2.0, 0.0, 0.0, 0.0]
                for et in et_values
            ],
            dtype=float,
        )
        return states, np.zeros(len(et_values), dtype=float)

    monkeypatch.setattr(spice_engine, "assert_spice_ready", lambda: None)
    monkeypatch.setattr(spice_engine.spice, "str2et", lambda ts: et_by_timestamp[ts])
    monkeypatch.setattr(spice_engine.spice, "spkezr", fake_spkezr)

    geometries = spice_engine._compute_mission_relative_geometry_batch_sync(
        ["2026-04-03T12:00:00Z", "2026-04-03T12:01:00Z"]
    )

    assert [call[0] for call in calls] == ["399", "301"]
    assert calls[0][1] == [1.0, 2.0]
    assert calls[1][1] == [1.0, 2.0]
    assert geometries[0]["et"] == 1.0
    assert geometries[0]["earth_pos"].tolist() == [101.0, 102.0, 103.0]
    assert geometries[1]["moon_pos"].tolist() == [302.0, 303.0, 304.0]


def test_compute_mission_relative_geometry_batch_preserves_valid_timestamps_after_parse_miss(monkeypatch):
    calls = []
    et_by_timestamp = {
        "2026-04-03T12:00:00": 1.0,
        "2026-04-03T12:02:00": 3.0,
    }

    def fake_spkezr(target, ets, frame, abcorr, observer):
        et_values = np.asarray(ets, dtype=float)
        calls.append((target, et_values.tolist(), frame, abcorr, observer))
        offset = 100.0 if target == "399" else 300.0
        states = np.array(
            [
                [offset + et, offset + et + 1.0, offset + et + 2.0, 0.0, 0.0, 0.0]
                for et in et_values
            ],
            dtype=float,
        )
        return states, np.zeros(len(et_values), dtype=float)

    monkeypatch.setattr(spice_engine, "assert_spice_ready", lambda: None)
    monkeypatch.setattr(spice_engine.spice, "str2et", lambda ts: et_by_timestamp[ts])
    monkeypatch.setattr(spice_engine.spice, "spkezr", fake_spkezr)

    geometries = spice_engine._compute_mission_relative_geometry_batch_sync(
        ["2026-04-03T12:00:00Z", "not-a-timestamp", "2026-04-03T12:02:00Z"]
    )

    assert geometries[0] is not None
    assert geometries[1] is None
    assert geometries[2] is not None
    assert [call[0] for call in calls] == ["399", "301"]
    assert calls[0][1] == [1.0, 3.0]
    assert geometries[0]["earth_pos"].tolist() == [101.0, 102.0, 103.0]
    assert geometries[2]["moon_pos"].tolist() == [303.0, 304.0, 305.0]


def test_compute_mission_relative_geometry_batch_preserves_valid_samples_after_spkezr_miss(monkeypatch):
    calls = []
    et_by_timestamp = {
        "2026-04-03T12:00:00": 1.0,
        "2026-04-03T12:01:00": 2.0,
        "2026-04-03T12:02:00": 3.0,
    }

    def fake_spkezr(target, ets, frame, abcorr, observer):
        et_values = np.asarray(ets, dtype=float)
        calls.append((target, et_values.tolist(), frame, abcorr, observer))
        if 2.0 in et_values:
            raise RuntimeError("coverage gap")
        offset = 100.0 if target == "399" else 300.0
        states = np.array(
            [
                [offset + et, offset + et + 1.0, offset + et + 2.0, 0.0, 0.0, 0.0]
                for et in et_values
            ],
            dtype=float,
        )
        return states, np.zeros(len(et_values), dtype=float)

    monkeypatch.setattr(spice_engine, "assert_spice_ready", lambda: None)
    monkeypatch.setattr(spice_engine.spice, "str2et", lambda ts: et_by_timestamp[ts])
    monkeypatch.setattr(spice_engine.spice, "spkezr", fake_spkezr)

    geometries = spice_engine._compute_mission_relative_geometry_batch_sync(
        ["2026-04-03T12:00:00Z", "2026-04-03T12:01:00Z", "2026-04-03T12:02:00Z"]
    )

    assert geometries[0] is not None
    assert geometries[1] is None
    assert geometries[2] is not None
    assert geometries[0]["earth_pos"].tolist() == [101.0, 102.0, 103.0]
    assert geometries[2]["moon_pos"].tolist() == [303.0, 304.0, 305.0]
    assert ("399", [1.0, 2.0, 3.0], "ECLIPJ2000", "NONE", "10") in calls
