from app.services.nasa_client import calculate_trajectory_params, _parse_horizons_csv

def test_calculate_trajectory_params():
    # Fast bodies
    _, s1 = calculate_trajectory_params("501", 30)
    assert s1 == "1 h"  # Io
    _, s2 = calculate_trajectory_params("401", 30)
    assert s2 == "1 h"  # Phobos
    
    # Medium bodies
    _, s3 = calculate_trajectory_params("502", 30)
    assert s3 == "1 h"  # Europa
    _, s4 = calculate_trajectory_params("801", 30)
    assert s4 == "1 h"  # Triton
    
    # Slow bodies
    _, s5 = calculate_trajectory_params("199", 30)
    assert s5 == "1 h" # Mercury
    
    # Outer bodies
    _, s6 = calculate_trajectory_params("399", 30)
    # Earth: period 365.25. span = 365.25/12 = 30.4. total_hours = 730. step = 730/200 = 3.65 -> 3h.
    assert s6 == "3 h"

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
