from __future__ import annotations

from datetime import datetime
from typing import Optional

import asyncio
import numpy as np
import spiceypy as spice
from loguru import logger 

from app.models.schemas import EphemerisData, EphemerisTrajectory, OrbitLineProfile
from app.services.body_catalog import BODY_NAMES, MOON_PARENTS
from app.services.spice_kernel_manager import assert_spice_ready
from app.services.spice_windows import (
    calculate_trajectory_params as calculate_trajectory_params,
    _parse_target_datetime, _resolve_window, resolve_target_observer,
)


def _to_scene_coords(state_xyz: np.ndarray) -> dict[str, float]:
    return {
        "x": float(state_xyz[0]),
        "y": float(state_xyz[2]),
        "z": -float(state_xyz[1]),
    }


def _et_to_iso_z(et: float) -> str:
    return f"{spice.et2utc(et, 'ISOC', 3)}Z"


def _build_trajectory(
    target_id: str,
    observer_id: str,
    start_dt: datetime,
    end_dt: datetime,
    steps: int,
) -> list[EphemerisTrajectory]:
    et_start = spice.str2et(start_dt.isoformat())
    et_end = spice.str2et(end_dt.isoformat())
    times = np.linspace(et_start, et_end, steps, dtype=float)

    states, _ = spice.spkezr(target_id, times, "ECLIPJ2000", "NONE", observer_id)
    states_array = np.asarray(states, dtype=float)
    if states_array.ndim == 1:
        states_array = states_array.reshape(1, 6)

    trajectory: list[EphemerisTrajectory] = []

    for i in range(states_array.shape[0]):
        position = _to_scene_coords(states_array[i, 0:3])
        velocity = _to_scene_coords(states_array[i, 3:6])
        ts = _et_to_iso_z(times[i])

        trajectory.append(
            EphemerisTrajectory.model_validate(
                {
                    "position": position,
                    "velocity": velocity,
                    "timestamp": ts,
                }
            )
        )

    return trajectory


def compute_ephemeris(
    body_id: str,
    target_date: str,
    center_body: str = "10",
    span_days: int = 30,
    full_orbit: bool = False,
    orbit_ready: bool = False,
    orbit_profile: OrbitLineProfile = OrbitLineProfile.AUTO,
    orbit_line_only: bool = False,
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
                "trajectory": [] if orbit_line_only else [
                    {
                        "position": {"x": 0, "y": 0, "z": 0},
                        "velocity": {"x": 0, "y": 0, "z": 0},
                        "timestamp": target_date,
                    }
                ],
            }
        )

    target_id, observer_id = resolve_target_observer(body_id, center_body)
    parent_id = MOON_PARENTS.get(body_id)
    start_dt, end_dt, steps = _resolve_window(
        body_id, target_date, span_days, full_orbit=full_orbit
    )
    
    # Calculate the exact position and velocity for the target_date
    try:
        et_target = spice.str2et(_parse_target_datetime(target_date).isoformat())
        target_state, _ = spice.spkezr(target_id, et_target, "ECLIPJ2000", "NONE", observer_id)
        current_pos = _to_scene_coords(target_state[0:3])
        current_vel = _to_scene_coords(target_state[3:6])
        
        trajectory = _build_trajectory(target_id, observer_id, start_dt, end_dt, steps)
    except Exception as e:
        logger.error(f"Error SPICE on body {body_id}: {str(e)}")
        return None

    if not trajectory:
        return None

    # Process orbit ready line if requested and body is a moon
    orbit_line = None
    if orbit_ready and body_id in MOON_PARENTS:
        from app.services.orbit_line_service import build_orbit_line
        orbit_line = build_orbit_line(body_id, trajectory, target_date, orbit_profile)

    return EphemerisData.model_validate(
        {
            "bodyId": body_id,
            "name": BODY_NAMES.get(body_id, f"Body {body_id}"),
            "position": current_pos,
            "velocity": current_vel,
            "timestamp": target_date,
            "parentId": parent_id,
            "trajectory": None if orbit_line_only else trajectory,
            "orbitLine": orbit_line,
        }
    )


def _fetch_all_spice_sync(
    body_ids: list[str],
    target_date: str,
    center_body: str = "10",
    span_days: int = 30,
    full_orbit: bool = False,
    orbit_ready: bool = False,
    orbit_profile: OrbitLineProfile = OrbitLineProfile.AUTO,
    orbit_line_only: bool = False,
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
                orbit_ready=orbit_ready,
                orbit_profile=orbit_profile,
                orbit_line_only=orbit_line_only,
            )
            if item:
                data.append(item)
        except Exception as e:
            logger.error(f"[fetch_all_spice] Failed to compute ephemeris for body {body_id}: {e}")

    return data


async def fetch_all_spice(
    body_ids: list[str],
    target_date: str,
    center_body: str = "10",
    span_days: int = 30,
    full_orbit: bool = False,
    orbit_ready: bool = False,
    orbit_profile: OrbitLineProfile = OrbitLineProfile.AUTO,
    orbit_line_only: bool = False,
) -> list[EphemerisData]:
    return await asyncio.to_thread(
        _fetch_all_spice_sync,
        body_ids,
        target_date,
        center_body,
        span_days,
        full_orbit,
        orbit_ready,
        orbit_profile,
        orbit_line_only,
    )

