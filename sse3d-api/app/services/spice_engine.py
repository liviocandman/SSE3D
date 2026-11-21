from __future__ import annotations

from threading import Lock
from typing import Optional

import asyncio
import numpy as np
import spiceypy as spice
from loguru import logger 
from spiceypy.utils.exceptions import SpiceSPKINSUFFDATA

from app.models.schemas import EphemerisData, EphemerisTrajectory, EphemerisTrajectorySection, OrbitLineProfile
from app.services.body_catalog import BODY_NAMES, MOON_PARENTS
from app.services.spice_kernel_manager import assert_spice_ready, get_spice_runtime_status
from app.services.spice_windows import (
    OUTER_PLANET_BARYCENTERS,
    calculate_trajectory_params as calculate_trajectory_params,
    _parse_target_datetime, _resolve_window, resolve_target_observer,
)


# CSPICE shares native process state and cannot compute in parallel threads.
# Acquire inside the worker so cancellation of an HTTP task cannot release it
# while that task's native computation is still running.
_SPICE_COMPUTATION_LOCK = Lock()

# Bound native work queued behind the process-wide lock. Equivalent callers
# share a task and do not consume another slot. The loop is part of the key
# because asyncio Tasks cannot be awaited by another event loop.
MAX_SPICE_PENDING_REQUESTS = 8
MAX_EPHEMERIS_BODY_IDS = 32
_SPICE_REQUESTS_LOCK = Lock()
_SPICE_REQUESTS: dict[tuple, asyncio.Task[list[EphemerisData]]] = {}


class SpiceCapacityError(RuntimeError):
    """The process already has its maximum number of distinct SPICE jobs."""


def _finish_spice_request(key: tuple, task: asyncio.Task) -> None:
    with _SPICE_REQUESTS_LOCK:
        if _SPICE_REQUESTS.get(key) is task:
            del _SPICE_REQUESTS[key]
    # Observe errors even if every HTTP caller disconnected while native work
    # was running. Other waiters still receive the original exception.
    if not task.cancelled():
        task.exception()


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
    et_start: float,
    et_end: float,
    steps: int,
) -> list[EphemerisTrajectory]:
    # UTC timestamps use millisecond precision; a boundary can leave only the exact state.
    steps = min(steps, int((et_end - et_start) * 1000) + 1)
    times = np.linspace(et_start, et_end, steps, dtype=float) if steps > 1 else [et_end]

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


def _intersect_coverage(
    windows: list[tuple[float, float]], et_start: float, et_end: float,
) -> list[tuple[float, float]]:
    return [
        (max(start, et_start), min(end, et_end))
        for start, end in windows if start <= et_end and end >= et_start
    ]


def _dynamic_outer_planet_windows(
    body_id: str, barycenter_id: str, observer_id: str, et_start: float, et_target: float,
) -> list[tuple[str, float, float]]:
    coverage = get_spice_runtime_status().coverage_windows_et
    observer_code = observer_id if observer_id.isdigit() else str(spice.bods2c(observer_id))
    requested_window = [(et_start, et_target)]
    if body_id == observer_code:
        return [(body_id, et_start, et_target)]

    physical_windows = _intersect_coverage(coverage.get(body_id, []), et_start, et_target)
    # Keep physical boundary instants. Barycentric samples must serialize to
    # different UTC milliseconds so they cannot replace the boundary samples.
    candidates: list[tuple[str, float, float]] = []
    cursor = et_start
    for start, end in physical_windows:
        if cursor <= start - 0.001:
            candidates.append((barycenter_id, cursor, start - 0.001))
        candidates.append((body_id, start, end))
        cursor = end + 0.001
    if cursor <= et_target:
        candidates.append((barycenter_id, cursor, et_target))

    windows = []
    observer_coverage = coverage.get(observer_code, requested_window)
    for target, start, end in candidates:
        if target == observer_code:
            windows.append((target, start, end))
            continue
        target_coverage = coverage.get(target, requested_window)
        for observer_start, observer_end in _intersect_coverage(observer_coverage, start, end):
            for covered_start, covered_end in _intersect_coverage(target_coverage, observer_start, observer_end):
                windows.append((target, covered_start, covered_end))
    return windows


def _build_dynamic_outer_planet_trajectories(
    body_id: str, target_id: str, barycenter_id: str, observer_id: str,
    et_start: float, et_target: float, steps: int,
) -> tuple[list[EphemerisTrajectory], list[EphemerisTrajectorySection]]:
    windows = _dynamic_outer_planet_windows(body_id, barycenter_id, observer_id, et_start, et_target)
    primary = []
    remainder = []
    window_duration = et_target - et_start
    for window_target, start, end in windows:
        is_primary = window_target == target_id and end == et_target
        if end == et_target and not is_primary:
            continue
        intervals = round((end - start) * (steps - 1) / window_duration)
        try:
            trajectory = _build_trajectory(window_target, observer_id, start, end, max(2, intervals + 1))
        except SpiceSPKINSUFFDATA:
            # A custom observer can lack an intermediate SPK link even where
            # its raw coverage overlaps the target in the manifest.
            continue
        if is_primary:
            primary = trajectory
        else:
            remainder.append(EphemerisTrajectorySection(
                reference_center="system_barycenter" if window_target == barycenter_id else None,
                trajectory=trajectory,
            ))

    # The exact state is already known to be available, even when the requested
    # observer chain prevents sampling an interval around it.
    if not primary:
        primary = _build_trajectory(target_id, observer_id, et_target, et_target, 1)
    return primary, remainder


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

    target_id, observer_id = resolve_target_observer(
        body_id, center_body, full_orbit=full_orbit
    )
    parent_id = MOON_PARENTS.get(body_id)
    start_dt, end_dt, steps = _resolve_window(
        body_id, target_date, span_days, full_orbit=full_orbit
    )
    barycenter_id = OUTER_PLANET_BARYCENTERS.get(body_id) if not full_orbit else None
    reference_center = None
    additional_trajectories = []
    
    # Calculate the exact position and velocity for the target_date
    try:
        et_target = spice.str2et(_parse_target_datetime(target_date).isoformat())
        try:
            target_state, _ = spice.spkezr(target_id, et_target, "ECLIPJ2000", "NONE", observer_id)
        except SpiceSPKINSUFFDATA:
            if barycenter_id is None:
                raise
            target_id = barycenter_id
            target_state, _ = spice.spkezr(target_id, et_target, "ECLIPJ2000", "NONE", observer_id)
            reference_center = "system_barycenter"
        current_pos = _to_scene_coords(target_state[0:3])
        current_vel = _to_scene_coords(target_state[3:6])

        et_start = spice.str2et(start_dt.isoformat())
        if barycenter_id:
            trajectory, additional_trajectories = _build_dynamic_outer_planet_trajectories(
                body_id, target_id, barycenter_id, observer_id, et_start, et_target, steps,
            )
        else:
            et_end = spice.str2et(end_dt.isoformat())
            trajectory = _build_trajectory(target_id, observer_id, et_start, et_end, steps)
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
            "referenceCenter": reference_center,
            "trajectory": None if orbit_line_only else trajectory,
            "additionalTrajectories": None if orbit_line_only else additional_trajectories or None,
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
    with _SPICE_COMPUTATION_LOCK:
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
    if len(body_ids) > MAX_EPHEMERIS_BODY_IDS:
        raise ValueError(f"At most {MAX_EPHEMERIS_BODY_IDS} bodies may be requested")
    if not body_ids:
        return []

    normalized_ids = tuple(sorted(set(body_ids)))
    key = (
        asyncio.get_running_loop(),
        normalized_ids,
        target_date,
        center_body,
        span_days,
        full_orbit,
        orbit_ready,
        orbit_profile,
        orbit_line_only,
    )
    with _SPICE_REQUESTS_LOCK:
        task = _SPICE_REQUESTS.get(key)
        if task is None:
            if len(_SPICE_REQUESTS) >= MAX_SPICE_PENDING_REQUESTS:
                raise SpiceCapacityError("SPICE computation queue is full")
            task = asyncio.create_task(asyncio.to_thread(
                _fetch_all_spice_sync,
                list(normalized_ids),
                target_date,
                center_body,
                span_days,
                full_orbit,
                orbit_ready,
                orbit_profile,
                orbit_line_only,
            ))
            _SPICE_REQUESTS[key] = task
            task.add_done_callback(lambda done: _finish_spice_request(key, done))

    # Cancelling one HTTP request must not cancel shared work or free a slot
    # while CSPICE is still executing in its native thread.
    return await asyncio.shield(task)

