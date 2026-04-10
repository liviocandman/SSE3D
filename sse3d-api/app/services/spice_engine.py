from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import spiceypy as spice
from loguru import logger 

from app.models.schemas import EphemerisData, EphemerisTrajectory, OrbitLineProfile
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
        return float(requested_span), 200 if not full_orbit else 600

    if full_orbit:
        span = period
        target_points = 600
    else:
        span = float(requested_span)
        target_points = 200

    return span, max(2, target_points)


def _parse_target_datetime(target_date: str) -> datetime:
    if "T" in target_date:
        return datetime.fromisoformat(target_date.replace("Z", "+00:00")).replace(tzinfo=None)
    return datetime.strptime(target_date, "%Y-%m-%d")


def _to_scene_coords(state_xyz: np.ndarray) -> dict[str, float]:
    return {
        "x": float(state_xyz[0]),
        "y": float(state_xyz[2]),
        "z": -float(state_xyz[1]),
    }


def _et_to_iso_z(et: float) -> str:
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

    observer_id = MOON_PARENTS.get(body_id, center_body)
    parent_id = MOON_PARENTS.get(body_id)
    start_dt, end_dt, steps = _resolve_window(
        body_id, target_date, span_days, full_orbit=full_orbit
    )
    
    # Baricenter is mandatory for outer planets always
    target_id = body_id
    if body_id in ["599", "699", "799", "899", "999"]:
        target_id = body_id[0]

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

def compute_mission_relative_geometry(target_date: str) -> Optional[dict]:
    """
    Computes Earth and Moon states at target_date for mission geometry calculations.
    Returns raw numpy arrays for positions in ECLIPJ2000.
    """
    try:
        assert_spice_ready()
        dt = _parse_target_datetime(target_date)
        et = spice.str2et(dt.isoformat())
        
        earth_state, _ = spice.spkezr("399", et, "ECLIPJ2000", "NONE", "10")
        moon_state, _ = spice.spkezr("301", et, "ECLIPJ2000", "NONE", "10")
        
        return {
            "et": et,
            "earth_pos": np.array(earth_state[0:3]),
            "moon_pos": np.array(moon_state[0:3])
        }
    except Exception as e:
        logger.error(f"Error computing mission relative geometry: {str(e)}")
        return None

def compute_mission_trajectory(start_date: str, end_date: str, steps: int = 100) -> Optional[dict]:
    """
    Computes a mission trajectory window without using planetary full_orbit logic.
    Provides ET times and corresponding Earth, Moon, and potentially Orion states for the window.
    """
    try:
        assert_spice_ready()
        dt_start = _parse_target_datetime(start_date)
        dt_end = _parse_target_datetime(end_date)
        
        et_start = spice.str2et(dt_start.isoformat())
        et_end = spice.str2et(dt_end.isoformat())
        
        times = np.linspace(et_start, et_end, steps, dtype=float)
        
        earth_states, _ = spice.spkezr("399", times, "ECLIPJ2000", "NONE", "10")
        moon_states, _ = spice.spkezr("301", times, "ECLIPJ2000", "NONE", "10")
        
        earth_states = np.asarray(earth_states, dtype=float)
        moon_states = np.asarray(moon_states, dtype=float)
        
        if earth_states.ndim == 1:
            earth_states = earth_states.reshape(1, 6)
            moon_states = moon_states.reshape(1, 6)
            
        orion_pos = None
        orion_vel = None
        try:
            orion_states, _ = spice.spkezr("-98", times, "ECLIPJ2000", "NONE", "10")
            orion_states = np.asarray(orion_states, dtype=float)
            if orion_states.ndim == 1:
                orion_states = orion_states.reshape(1, 6)
            orion_pos = orion_states[:, 0:3]
            orion_vel = orion_states[:, 3:6]
        except Exception:
            logger.debug("Orion (-98) kernel not found in SPICE. Mission trajectory will rely on fallback data.")
            
        return {
            "times": times,
            "earth_pos": earth_states[:, 0:3],
            "moon_pos": moon_states[:, 0:3],
            "orion_pos": orion_pos,
            "orion_vel": orion_vel
        }
    except Exception as e:
        logger.error(f"Error computing mission trajectory: {str(e)}")
        return None
