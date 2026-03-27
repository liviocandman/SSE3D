import pytest
from app.services.nasa_client import get_step_size, _parse_horizons_csv
from app.models.schemas import EphemerisData

def test_get_step_size():
    # Fast bodies
    assert get_step_size("501") == "1 h"  # Io
    assert get_step_size("401") == "1 h"  # Phobos
    
    # Medium bodies
    assert get_step_size("502") == "6 h"  # Europa
    assert get_step_size("801") == "6 h"  # Triton
    
    # Slow bodies
    assert get_step_size("199") == "12 h" # Mercury
    assert get_step_size("301") == "12 h" # Moon
    
    # Outer bodies
    assert get_step_size("399") == "1 d"  # Earth
    assert get_step_size("599") == "1 d"  # Jupiter
    assert get_step_size("899") == "1 d"  # Neptune

def test_parse_horizons_csv_trajectory():
    # Mock CSV result from NASA with two points (using realistic AU values for Earth ~1.0)
    mock_result = """
*******************************************************************************
$$SOE
2461126.500000000, A.D. 2026-Mar-26 00:00:00.0000,  0.95287508,  0.29871900, -0.00003130, -0.0051234,  0.0163456,  0.0000001
2461126.541666667, A.D. 2026-Mar-26 01:00:00.0000,  0.95265021,  0.29940935, -0.00003130, -0.0051345,  0.0163226,  0.0000001
$$EOE
*******************************************************************************
"""
    body_id = "399"
    target_date = "2026-03-26"
    
    data = _parse_horizons_csv(mock_result, body_id, target_date)
    
    assert data is not None
    assert data.body_id == body_id
    assert len(data.trajectory) == 2
    
    # Check first point
    # X in CSV: 0.95287508 AU
    expected_x_km = 0.95287508 * 149_597_870.7
    assert abs(data.trajectory[0].position.x - expected_x_km) < 0.1
    
    assert data.trajectory[0].timestamp == "2026-Mar-26 00:00:00.0000"
    assert data.trajectory[1].timestamp == "2026-Mar-26 01:00:00.0000"
    
def test_parse_horizons_csv_invalid():
    assert _parse_horizons_csv("invalid data", "399", "2026-03-26") is None
