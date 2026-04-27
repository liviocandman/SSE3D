from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple
import math

from app.models.schemas import OrbitLineData, OrbitLinePoint, OrbitLineProfile, EphemerisTrajectory
from app.services.body_catalog import (
    RAPID_MOON_IDS, 
    RAPID_WINDOW_HOURS, 
    REGULAR_WINDOW_DAYS, 
    MIN_POINTS_PER_PROFILE,
    TARGET_POINTS_RAPID,
    TARGET_POINTS_REGULAR
)
from app.core.config import settings

ALGORITHM_VERSION = settings.orbit_ready_algorithm_version

def _parse_iso_datetime_utc(value: str) -> Optional[datetime]:
    if not value:
        return None

    normalized = value.strip()
    try:
        if normalized.endswith("Z"):
            parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        else:
            parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)

def resolve_orbit_profile(body_id: str, requested_profile: OrbitLineProfile) -> OrbitLineProfile:
    if requested_profile != OrbitLineProfile.AUTO:
        return requested_profile
    
    if body_id in RAPID_MOON_IDS:
        return OrbitLineProfile.RAPID
    return OrbitLineProfile.REGULAR

def sanitize_points(trajectory: List[EphemerisTrajectory]) -> List[EphemerisTrajectory]:
    """Remove duplicates and points with NaN coordinates."""
    if not trajectory:
        return []
    
    sanitized = []
    seen_timestamps = set()
    
    for p in trajectory:
        # Check for NaN
        if (math.isnan(p.position.x) or 
            math.isnan(p.position.y) or 
            math.isnan(p.position.z)):
            continue
            
        # Check for duplicates by timestamp
        if p.timestamp in seen_timestamps:
            continue
            
        sanitized.append(p)
        seen_timestamps.add(p.timestamp)
        
    return sanitized

def select_window(points: List[EphemerisTrajectory], profile: OrbitLineProfile, target_time_str: str) -> List[EphemerisTrajectory]:
    """Select a window of points around the target time."""
    if not points:
        return []

    target_dt = _parse_iso_datetime_utc(target_time_str)
    if target_dt is None:
        return []
        
    if profile == OrbitLineProfile.RAPID:
        window_delta = timedelta(hours=RAPID_WINDOW_HOURS)
    else:
        window_delta = timedelta(days=REGULAR_WINDOW_DAYS)
        
    half_window = window_delta / 2
    start_dt = target_dt - half_window
    end_dt = target_dt + half_window
    
    window_points = []
    for p in points:
        p_dt = _parse_iso_datetime_utc(p.timestamp)
        if p_dt is None:
            continue
        if start_dt <= p_dt <= end_dt:
            window_points.append(p)
            
    return window_points

def _is_target_outside_points_range(points: List[EphemerisTrajectory], target_time_str: str) -> bool:
    if not points:
        return False

    target_dt = _parse_iso_datetime_utc(target_time_str)
    if target_dt is None:
        return False

    first_dt = _parse_iso_datetime_utc(points[0].timestamp)
    last_dt = _parse_iso_datetime_utc(points[-1].timestamp)
    if first_dt is None or last_dt is None:
        return False

    if first_dt > last_dt:
        first_dt, last_dt = last_dt, first_dt

    return target_dt < first_dt or target_dt > last_dt

def decide_closure(points: List[EphemerisTrajectory], profile: OrbitLineProfile) -> bool:
    """
    Decide if the orbit should be closed based on the distance between 
    the first and last point relative to the average step.
    """
    if len(points) < 3:
        return False
        
    p1 = points[0].position
    p2 = points[-1].position
    
    dist_sq = (p1.x - p2.x)**2 + (p1.y - p2.y)**2 + (p1.z - p2.z)**2
    dist = math.sqrt(dist_sq)
    
    # Calculate average distance between consecutive points
    total_dist = 0
    for i in range(len(points) - 1):
        pa = points[i].position
        pb = points[i+1].position
        d = math.sqrt((pa.x - pb.x)**2 + (pa.y - pb.y)**2 + (pa.z - pb.z)**2)
        total_dist += d
    
    avg_dist = total_dist / (len(points) - 1)
    
    # If the gap is less than 2x the average step, we can close it
    # For rapid moons we are more lenient as they often cover full orbits
    threshold = 2.0 if profile == OrbitLineProfile.RAPID else 1.5
    
    return dist < (avg_dist * threshold)

def apply_smoothing(points: List[EphemerisTrajectory], is_closed: bool, profile: OrbitLineProfile) -> List[OrbitLinePoint]:
    """
    Apply simple smoothing or just convert to OrbitLinePoint.
    Currently, we just map to the output type. Bounded point count is handled 
    by the input trajectory generation in spice_engine usually, but we ensure it here.
    """
    target_count = TARGET_POINTS_RAPID if profile == OrbitLineProfile.RAPID else TARGET_POINTS_REGULAR
    
    # If we have too many points, we sub-sample
    if len(points) > target_count:
        step = len(points) / target_count
        sub_sampled = []
        for i in range(target_count):
            idx = int(i * step)
            if idx < len(points):
                sub_sampled.append(points[idx])
        points = sub_sampled

    return [
        OrbitLinePoint(x=p.position.x, y=p.position.y, z=p.position.z, timestamp=p.timestamp)
        for p in points
    ]

def apply_anti_spider_guard(points: List[OrbitLinePoint], is_closed: bool) -> Tuple[List[OrbitLinePoint], bool, List[str]]:
    """
    Detect and fix 'spider' effects where points jump to extreme values 
    or create unrealistic long lines.
    """
    if len(points) < 3:
        return points, is_closed, []
        
    flags = ["anti_spider_passed"]
    
    # Check for extreme jumps (3 sigma or simple threshold)
    # For now, if a distance between two points is > 10x the average, we mark it.
    # We don't necessarily 'fix' it by removing yet, but we can open the orbit.
    
    total_dist = 0
    dists = []
    for i in range(len(points) - 1):
        p1 = points[i]
        p2 = points[i+1]
        d = math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2 + (p1.z - p2.z)**2)
        total_dist += d
        dists.append(d)
        
    avg_dist = total_dist / len(dists)
    
    for d in dists:
        if d > avg_dist * 50: # Extreme jump
            is_closed = False
            flags = ["spider_detected_opening_orbit"]
            break
            
    return points, is_closed, flags

def build_orbit_line(
    body_id: str, 
    trajectory: List[EphemerisTrajectory], 
    target_time: str, 
    requested_profile: OrbitLineProfile = OrbitLineProfile.AUTO
) -> Optional[OrbitLineData]:
    if not trajectory:
        return None
        
    profile = resolve_orbit_profile(body_id, requested_profile)
    
    sanitized = sanitize_points(trajectory)
    if not sanitized:
        return None
        
    window = select_window(sanitized, profile, target_time)
    if len(window) < MIN_POINTS_PER_PROFILE:
        # Common full-orbit scenario:
        # target date may be a bucket date outside the generated trajectory time range.
        # In this case, keep a deterministic non-empty orbit by using sanitized points.
        if _is_target_outside_points_range(sanitized, target_time) and len(sanitized) >= MIN_POINTS_PER_PROFILE:
            window = sanitized
        elif len(sanitized) >= MIN_POINTS_PER_PROFILE:
            # Safety fallback for sparse/offset windows while preserving a visible orbit line.
            window = sanitized
        else:
            return None
        
    is_closed = decide_closure(window, profile)
    
    points = apply_smoothing(window, is_closed, profile)
    points, is_closed, flags = apply_anti_spider_guard(points, is_closed)
    
    source_window_start = window[0].timestamp
    source_window_end = window[-1].timestamp
    
    return OrbitLineData(
        points=points,
        isClosed=is_closed,
        profile=profile,
        algorithmVersion=ALGORITHM_VERSION,
        sourceWindowStart=source_window_start,
        sourceWindowEnd=source_window_end,
        inputPointCount=len(window),
        outputPointCount=len(points),
        qualityFlags=flags
    )
