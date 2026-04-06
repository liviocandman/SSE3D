import numpy as np

from app.models.mission_schemas import MissionAttitudeMode, MissionPhase
from app.services.mission_attitude_service import (
    compute_policy_attitude_rotation,
    resolve_attitude_mode,
)


def test_resolve_attitude_mode_uses_nose_to_moon_for_lunar_flyby():
    assert resolve_attitude_mode(MissionPhase.LUNAR_FLYBY) == MissionAttitudeMode.NOSE_TO_MOON
    assert resolve_attitude_mode(MissionPhase.TRANSLUNAR_COAST) == MissionAttitudeMode.TAIL_TO_SUN
    assert resolve_attitude_mode(MissionPhase.RETURN_COAST) == MissionAttitudeMode.TAIL_TO_SUN


def test_policy_attitude_points_nose_to_moon_during_lunar_flyby():
    rotation, mode, confidence = compute_policy_attitude_rotation(
        phase=MissionPhase.LUNAR_FLYBY,
        et=0.0,
        velocity_vec=np.array([0.0, 1.0, 0.0], dtype=float),
        earth_nadir_vec=np.array([-1.0, 0.0, 0.0], dtype=float),
        sun_to_orion_vec=np.array([1.0, 0.0, 0.0], dtype=float),
        moon_nadir_vec=np.array([0.0, 0.0, 5.0], dtype=float),
    )

    body_x_axis = rotation[:, 0]

    assert mode == MissionAttitudeMode.NOSE_TO_MOON
    assert confidence > 0.7
    assert np.allclose(body_x_axis, np.array([0.0, 0.0, 1.0]), atol=1e-6)
