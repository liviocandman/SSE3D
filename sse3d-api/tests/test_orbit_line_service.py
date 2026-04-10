import pytest
import math
from app.models.schemas import OrbitLineProfile, EphemerisTrajectory, Position
from app.services.orbit_line_service import (
    resolve_orbit_profile,
    sanitize_points,
    select_window,
    decide_closure,
    apply_anti_spider_guard,
    build_orbit_line
)

def test_resolve_orbit_profile():
    # Auto resolution
    assert resolve_orbit_profile("401", OrbitLineProfile.AUTO) == OrbitLineProfile.RAPID
    assert resolve_orbit_profile("402", OrbitLineProfile.AUTO) == OrbitLineProfile.RAPID
    assert resolve_orbit_profile("301", OrbitLineProfile.AUTO) == OrbitLineProfile.REGULAR
    
    # Explicit override
    assert resolve_orbit_profile("401", OrbitLineProfile.REGULAR) == OrbitLineProfile.REGULAR
    assert resolve_orbit_profile("301", OrbitLineProfile.RAPID) == OrbitLineProfile.RAPID

def test_sanitize_points():
    points = [
        EphemerisTrajectory(position=Position(x=1, y=1, z=1), timestamp="2026-04-08T00:00:00Z"),
        EphemerisTrajectory(position=Position(x=float('nan'), y=1, z=1), timestamp="2026-04-08T00:01:00Z"),
        EphemerisTrajectory(position=Position(x=2, y=2, z=2), timestamp="2026-04-08T00:00:00Z"), # Duplicate TS
        EphemerisTrajectory(position=Position(x=3, y=3, z=3), timestamp="2026-04-08T00:02:00Z"),
    ]
    
    sanitized = sanitize_points(points)
    assert len(sanitized) == 2
    assert sanitized[0].position.x == 1
    assert sanitized[1].position.x == 3

def test_select_window():
    points = [
        EphemerisTrajectory(position=Position(x=i, y=i, z=i), timestamp=f"2026-04-{i+1:02d}T00:00:00Z")
        for i in range(10)
    ]
    
    # Rapid profile uses 24h window (+/- 12h)
    window_rapid = select_window(points, OrbitLineProfile.RAPID, "2026-04-05T00:00:00Z")
    assert len(window_rapid) == 1
    assert window_rapid[0].timestamp == "2026-04-05T00:00:00Z"
    
    # Regular profile uses 30 day window (+/- 15 days)
    window_reg = select_window(points, OrbitLineProfile.REGULAR, "2026-04-05T00:00:00Z")
    assert len(window_reg) == 10

def test_select_window_accepts_date_only_target_time():
    points = [
        EphemerisTrajectory(position=Position(x=i, y=0, z=0), timestamp=f"2026-04-{i+1:02d}T00:00:00Z")
        for i in range(10)
    ]

    window = select_window(points, OrbitLineProfile.RAPID, "2026-04-05")
    assert len(window) == 1
    assert window[0].timestamp == "2026-04-05T00:00:00Z"

def test_decide_closure():
    # Circular-ish path
    points = []
    for i in range(20):
        angle = (i / 20) * 2 * math.pi
        points.append(EphemerisTrajectory(
            position=Position(x=math.cos(angle), y=0, z=math.sin(angle)),
            timestamp=str(i)
        ))
    
    # Almost closed
    assert decide_closure(points, OrbitLineProfile.RAPID) is True
    
    # Open path
    points = points[:10]
    assert decide_closure(points, OrbitLineProfile.RAPID) is False

def test_anti_spider_guard():
    from app.models.schemas import OrbitLinePoint
    # Many points to keep average low. 
    # With multiplier 50, we need N > 101 points to trigger jump detection 
    # if the jump itself dominates the average.
    points = [OrbitLinePoint(x=i, y=0, z=0, timestamp=str(i)) for i in range(200)]
    # One extreme jump
    points[100] = OrbitLinePoint(x=10000000, y=0, z=0, timestamp="100")
    
    pts, is_closed, flags = apply_anti_spider_guard(points, True)
    assert is_closed is False
    assert "spider_detected_opening_orbit" in flags

def test_build_orbit_line_integration():
    trajectory = [
        EphemerisTrajectory(
            position=Position(x=math.cos(i/10), y=0, z=math.sin(i/10)), 
            timestamp=f"2026-04-08T{i:02d}:00:00Z"
        )
        for i in range(24)
    ]
    
    orbit_line = build_orbit_line("401", trajectory, "2026-04-08T12:00:00Z")
    assert orbit_line is not None
    assert orbit_line.profile == OrbitLineProfile.RAPID
    assert orbit_line.input_point_count == 24
    assert orbit_line.output_point_count == 24
    assert "anti_spider_passed" in orbit_line.quality_flags

def test_build_orbit_line_falls_back_when_target_outside_range():
    # Simulates fullOrbit window where target_time may be far from trajectory timestamps.
    trajectory = [
        EphemerisTrajectory(
            position=Position(x=math.cos(i / 4), y=0, z=math.sin(i / 4)),
            timestamp=f"2026-01-01T{i:02d}:00:00Z"
        )
        for i in range(24)
    ]

    orbit_line = build_orbit_line("401", trajectory, "2026-04-08T00:00:00Z")
    assert orbit_line is not None
    assert orbit_line.input_point_count == 24
    assert orbit_line.output_point_count > 0
