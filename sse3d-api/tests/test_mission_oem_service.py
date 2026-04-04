import numpy as np
from datetime import datetime, timezone
from app.services.mission_oem_service import MissionOEMService, OEMStateVector
from app.models.mission_schemas import MissionPosition, MissionVelocity

def mock_state(x, y, z, timestamp="2026-01-01T00:00:00Z"):
    dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)
    return OEMStateVector(
        timestamp=timestamp,
        dt=dt,
        position=MissionPosition(x=x, y=y, z=z),
        velocity=MissionVelocity(x=0, y=0, z=0)
    )

def test_adaptive_sampler_preserves_endpoints():
    service = MissionOEMService()
    states = (
        mock_state(1000000, 0, 0, "2026-01-01T00:00:00Z"),
        mock_state(1000001, 0, 0, "2026-01-01T00:01:00Z"),
        mock_state(1000002, 0, 0, "2026-01-01T00:02:00Z"),
    )
    
    adaptive = service._build_adaptive_trajectory(states)
    
    assert len(adaptive) >= 2
    assert adaptive[0].timestamp == states[0].timestamp
    assert adaptive[-1].timestamp == states[-1].timestamp

def test_adaptive_sampler_dense_near_earth():
    service = MissionOEMService()
    # threshold is 250,000 km
    states = (
        mock_state(100000, 0, 0, "2026-01-01T00:00:00Z"),
        mock_state(100100, 0, 0, "2026-01-01T00:01:00Z"),
        mock_state(100200, 0, 0, "2026-01-01T00:02:00Z"),
        mock_state(100300, 0, 0, "2026-01-01T00:03:00Z"),
    )
    
    # Near Earth points should all be kept
    adaptive = service._build_adaptive_trajectory(states, near_earth_dense_km=250000)
    assert len(adaptive) == 4

def test_adaptive_sampler_angular_change():
    service = MissionOEMService()
    # Far from Earth (> 250,000 km)
    # Start at +X
    p1 = mock_state(500000, 0, 0, "2026-01-01T00:00:00Z")
    # Small change
    p2 = mock_state(500000, 1000, 0, "2026-01-01T00:01:00Z")
    # Big change (90 degrees)
    p3 = mock_state(0, 500000, 0, "2026-01-01T00:02:00Z")
    
    states = (p1, p2, p3)
    
    # angular_dot_threshold = 0.998 (~3.6 deg)
    adaptive = service._build_adaptive_trajectory(
        states,
        near_earth_dense_km=1000,
        segment_dot_threshold=-1.0,
        lunar_window_points=0,
        lunar_min_distance_km=1_000_000.0,
    )
    
    # p1 is first, kept.
    # p2 has very small angular change, should be skipped.
    # p3 is last, kept.
    # Result should be (p1, p3)
    assert len(adaptive) == 2
    assert adaptive[0].timestamp == p1.timestamp
    assert adaptive[1].timestamp == p3.timestamp

def test_adaptive_sampler_hard_limit():
    service = MissionOEMService()
    # Create 100 points
    states = tuple(mock_state(100000 + i, 0, 0, f"2026-01-01T00:{i:02}:00Z") for i in range(60))
    
    # All are near Earth, but hard limit is 10
    adaptive = service._build_adaptive_trajectory(states, hard_limit=10)
    
    assert len(adaptive) <= 10
    assert adaptive[0].timestamp == states[0].timestamp
    assert adaptive[-1].timestamp == states[-1].timestamp


def test_default_adaptive_sampler_limit_allows_more_than_old_500_cap():
    service = MissionOEMService()
    states = tuple(
        mock_state(100000 + i, (i % 5) * 2500, 0, f"2026-01-01T{i // 3600:02}:{(i // 60) % 60:02}:{i % 60:02}Z")
        for i in range(1800)
    )

    adaptive = service._build_adaptive_trajectory(states)

    # Regression guard: the default cache budget must not collapse the mission
    # back to the old global 500-point ceiling.
    assert len(adaptive) > 500


def test_adaptive_sampler_keeps_lunar_window_points():
    service = MissionOEMService()
    # Distances rise to apogee in the middle and then decrease.
    states = tuple(
        mock_state(200000 + i * 1000 if i <= 20 else 220000 + (40 - i) * 1000, 0, 0, f"2026-01-01T00:{i:02}:00Z")
        for i in range(41)
    )

    adaptive = service._build_adaptive_trajectory(
        states,
        near_earth_dense_km=150000.0,
        lunar_window_points=4,
        lunar_min_distance_km=210000.0,
        hard_limit=200,
    )

    kept_ts = {s.timestamp for s in adaptive}
    distances = [abs(s.position.x) for s in states]
    apogee_idx = int(np.argmax(distances))
    start = max(0, apogee_idx - 4)
    end = min(len(states) - 1, apogee_idx + 4)

    # Keep at least the configured local lunar window around apogee.
    for i in range(start, end + 1):
        assert states[i].timestamp in kept_ts


def test_adaptive_sampler_preserves_local_curvature_far_from_earth():
    service = MissionOEMService()
    states = (
        mock_state(500000, 0, 0, "2026-01-01T00:00:00Z"),
        mock_state(510000, 0, 0, "2026-01-01T00:01:00Z"),
        mock_state(520000, 15000, 0, "2026-01-01T00:02:00Z"),
        mock_state(520000, 50000, 0, "2026-01-01T00:03:00Z"),
    )

    adaptive = service._build_adaptive_trajectory(
        states,
        near_earth_dense_km=1000,
        angular_dot_threshold=0.999999,
        segment_dot_threshold=0.995,
    )

    kept_timestamps = [state.timestamp for state in adaptive]

    # The local bend at the third point should be preserved even though the
    # states are all far from Earth.
    assert states[2].timestamp in kept_timestamps
