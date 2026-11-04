"""Pure trajectory window functions shared by the engine and installer validation."""
from datetime import datetime, timedelta
from app.services.body_catalog import MOON_PARENTS, ORBITAL_PERIODS_DAYS

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


def resolve_target_observer(body_id: str, center_body: str = "10") -> tuple[str, str]:
    target = body_id[0] if body_id in {"599", "699", "799", "899", "999"} else body_id
    return target, MOON_PARENTS.get(body_id, center_body)
