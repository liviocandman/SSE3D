from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import spiceypy as spice

from app.models.schemas import EphemerisData, EphemerisTrajectory
from app.services.body_catalog import BODY_NAMES, MOON_PARENTS, ORBITAL_PERIODS_DAYS
from app.services.spice_kernel_manager import assert_spice_ready


def calculate_trajectory_params(
    body_id: str, requested_span: int, full_orbit: bool = False
) -> tuple[float, int]:
    """
    Returns (actual_span_days, steps) with approximately:
    - ~600 points for full orbit background lines
    - ~200 points for dynamic trajectories
    """
    period = ORBITAL_PERIODS_DAYS.get(body_id)
    if not period:
        span = float(requested_span)
        target_points = 600 if full_orbit else 200
        return span, max(2, target_points)

    is_moon = body_id in MOON_PARENTS

    if full_orbit:
        span = period
        target_points = 600
    elif is_moon:
        span = period * 1.1
        target_points = 200
    else:
        span = min(period / 12.0, 3650.0)
        target_points = 200

    return span, max(2, target_points)


def _parse_target_datetime(target_date: str) -> datetime:
    if "T" in target_date:
        return datetime.fromisoformat(target_date.replace("Z", "+00:00")).replace(tzinfo=None)
    return datetime.strptime(target_date, "%Y-%m-%d")


def _to_scene_coords(state_xyz: np.ndarray) -> dict[str, float]:
    # Preserve existing backend contract used by the frontend:
    # astronomy Z -> scene Y, astronomy Y -> scene Z.
    return {
        "x": float(state_xyz[0]),
        "y": float(state_xyz[2]),
        "z": float(state_xyz[1]),
    }


def _et_to_iso_z(et: float) -> str:
    # ISOC returns UTC-like "YYYY-MM-DDTHH:MM:SS.sss"
    return f"{spice.et2utc(et, 'ISOC', 3)}Z"


def _resolve_window(
    body_id: str, target_date: str, span_days: int, full_orbit: bool
) -> tuple[datetime, datetime, int]:
    actual_span, steps = calculate_trajectory_params(
        body_id, span_days, full_orbit=full_orbit
    )
    start_dt = _parse_target_datetime(target_date)

    is_moon = body_id in MOON_PARENTS
    if full_orbit:
        start_dt = datetime(start_dt.year, 1, 1, 0, 0, 0)
        end_dt = start_dt + timedelta(days=actual_span)
    elif not is_moon and body_id != "10":
        end_dt = start_dt
        start_dt = start_dt - timedelta(days=actual_span)
    else:
        end_dt = start_dt + timedelta(days=actual_span)

    return start_dt, end_dt, steps


def _build_trajectory(
    target_id: str,
    observer_id: str,
    start_dt: datetime,
    end_dt: datetime,
    steps: int,
) -> tuple[list[EphemerisTrajectory], Optional[dict[str, float]], Optional[dict[str, float]]]:
    et_start = spice.str2et(start_dt.isoformat())
    et_end = spice.str2et(end_dt.isoformat())
    times = np.linspace(et_start, et_end, steps, dtype=float)

    states, _ = spice.spkezr(target_id, times, "ECLIPJ2000", "NONE", observer_id)
    states_array = np.asarray(states, dtype=float)
    if states_array.ndim == 1:
        states_array = states_array.reshape(1, 6)

    trajectory: list[EphemerisTrajectory] = []
    first_position: Optional[dict[str, float]] = None
    first_velocity: Optional[dict[str, float]] = None

    for i in range(states_array.shape[0]):
        position = _to_scene_coords(states_array[i, 0:3])
        velocity = _to_scene_coords(states_array[i, 3:6])
        ts = _et_to_iso_z(times[i])

        if first_position is None:
            first_position = position
            first_velocity = velocity

        trajectory.append(
            EphemerisTrajectory.model_validate(
                {
                    "position": position,
                    "velocity": velocity,
                    "timestamp": ts,
                }
            )
        )

    return trajectory, first_position, first_velocity


def compute_ephemeris(
    body_id: str,
    target_date: str,
    center_body: str = "10",
    span_days: int = 30,
    full_orbit: bool = False,
) -> Optional[EphemerisData]:
    assert_spice_ready()

    if body_id == "10" and center_body == "10":
        return EphemerisData.model_validate(
            {
                "bodyId": "10",
                "name": "Sun",
                "position": {"x": 0, "y": 0, "z": 0},
                "velocity": {"x": 0, "y": 0, "z": 0},
                "timestamp": target_date,
                "trajectory": [
                    {
                        "position": {"x": 0, "y": 0, "z": 0},
                        "velocity": {"x": 0, "y": 0, "z": 0},
                        "timestamp": target_date,
                    }
                ],
            }
        )

    observer_id = MOON_PARENTS.get(body_id, center_body)
    parent_id = MOON_PARENTS.get(body_id)
    start_dt, end_dt, steps = _resolve_window(
        body_id, target_date, span_days, full_orbit=full_orbit
    )

    trajectory, first_pos, first_vel = _build_trajectory(
        body_id, observer_id, start_dt, end_dt, steps
    )
    if not trajectory or first_pos is None:
        return None

    return EphemerisData.model_validate(
        {
            "bodyId": body_id,
            "name": BODY_NAMES.get(body_id, f"Body {body_id}"),
            "position": first_pos,
            "velocity": first_vel,
            "timestamp": target_date,
            "parentId": parent_id,
            "trajectory": trajectory,
        }
    )


async def fetch_all_spice(
    body_ids: list[str],
    target_date: str,
    center_body: str = "10",
    span_days: int = 30,
    full_orbit: bool = False,
) -> list[EphemerisData]:
    data: list[EphemerisData] = []
    for body_id in body_ids:
        try:
            item = compute_ephemeris(
                body_id,
                target_date=target_date,
                center_body=center_body,
                span_days=span_days,
                full_orbit=full_orbit,
            )
        except Exception:
            item = None
        if item:
            data.append(item)
    return data
