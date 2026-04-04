import numpy as np

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
