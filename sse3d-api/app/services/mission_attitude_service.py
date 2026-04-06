import math
from typing import Optional

import numpy as np

from app.models.mission_schemas import MissionAttitudeMode, MissionPhase
from app.core.config import settings


def _normalize(vec: np.ndarray, fallback: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    if norm <= 1e-9:
        return fallback
    return vec / norm


def _rotation_from_x_and_hint(
    x_axis: np.ndarray,
    up_hint: np.ndarray,
) -> np.ndarray:
    x_axis = _normalize(x_axis, np.array([1.0, 0.0, 0.0], dtype=float))
    z_axis = _normalize(up_hint, np.array([0.0, 0.0, 1.0], dtype=float))
    y_axis = np.cross(z_axis, x_axis)
    if float(np.linalg.norm(y_axis)) <= 1e-9:
        z_axis = np.array([0.0, 1.0, 0.0], dtype=float)
        y_axis = np.cross(z_axis, x_axis)
    y_axis = _normalize(y_axis, np.array([0.0, 1.0, 0.0], dtype=float))
    z_axis = _normalize(np.cross(x_axis, y_axis), np.array([0.0, 0.0, 1.0], dtype=float))
    return np.column_stack((x_axis, y_axis, z_axis))


def _roll_about_x(angle_rad: float) -> np.ndarray:
    c = math.cos(angle_rad)
    s = math.sin(angle_rad)
    return np.array(
        [
            [1.0, 0.0, 0.0],
            [0.0, c, -s],
            [0.0, s, c],
        ],
        dtype=float,
    )


def resolve_attitude_mode(phase: MissionPhase) -> MissionAttitudeMode:
    if phase in (MissionPhase.TRANSLUNAR_COAST, MissionPhase.RETURN_COAST):
        return MissionAttitudeMode.TAIL_TO_SUN
    if phase == MissionPhase.LUNAR_FLYBY:
        return MissionAttitudeMode.NOSE_TO_MOON
    if phase in (MissionPhase.EARTH_DEPARTURE, MissionPhase.REENTRY):
        return MissionAttitudeMode.BURN_ALIGN
    return MissionAttitudeMode.HOLD


def compute_policy_attitude_rotation(
    *,
    phase: MissionPhase,
    et: float,
    velocity_vec: np.ndarray,
    earth_nadir_vec: np.ndarray,
    sun_to_orion_vec: np.ndarray,
    moon_nadir_vec: Optional[np.ndarray] = None,
) -> tuple[np.ndarray, MissionAttitudeMode, float]:
    """
    Returns a body->inertial rotation matrix from a mission policy attitude.
    This is an estimated operational model, not a CK-truth orientation.
    """
    mode = resolve_attitude_mode(phase)

    if mode == MissionAttitudeMode.TAIL_TO_SUN:
        # Tail-to-sun means the service module points toward the Sun.
        # We model body +X as nose-forward, therefore +X points away from Sun.
        x_axis = _normalize(sun_to_orion_vec, np.array([1.0, 0.0, 0.0], dtype=float))
        base_rot = _rotation_from_x_and_hint(x_axis, np.array([0.0, 0.0, 1.0], dtype=float))
        if settings.mission_policy_spin_enabled:
            spin_rate = math.radians(settings.mission_policy_tail_to_sun_spin_rate_deg_per_sec)
            roll = _roll_about_x(et * spin_rate)
            return base_rot @ roll, mode, 0.60
        return base_rot, mode, 0.58

    if mode == MissionAttitudeMode.NOSE_TO_MOON:
        x_axis = _normalize(
            moon_nadir_vec if moon_nadir_vec is not None else velocity_vec,
            np.array([1.0, 0.0, 0.0], dtype=float),
        )
        up_hint = velocity_vec
        if float(np.linalg.norm(up_hint)) <= 1e-9:
            up_hint = earth_nadir_vec
        if float(np.linalg.norm(up_hint)) <= 1e-9:
            up_hint = np.array([0.0, 0.0, 1.0], dtype=float)
        rot = _rotation_from_x_and_hint(x_axis, up_hint)
        confidence = 0.74 if moon_nadir_vec is not None else 0.64
        return rot, mode, confidence

    if mode == MissionAttitudeMode.BURN_ALIGN:
        x_axis = _normalize(velocity_vec, np.array([1.0, 0.0, 0.0], dtype=float))
        nadir = earth_nadir_vec
        if moon_nadir_vec is not None:
            if float(np.linalg.norm(moon_nadir_vec)) < float(np.linalg.norm(earth_nadir_vec)):
                nadir = moon_nadir_vec
        rot = _rotation_from_x_and_hint(x_axis, nadir)
        return rot, mode, 0.68

    # HOLD: keep a stable prograde-oriented frame without extra spin.
    rot = _rotation_from_x_and_hint(velocity_vec, earth_nadir_vec)
    return rot, mode, 0.50
