from app.services.spice_engine import calculate_trajectory_params


def test_calculate_trajectory_params():
    # Fast moon: Io
    span_io, steps_io = calculate_trajectory_params("501", 30)
    assert round(span_io, 3) == 1.946
    assert steps_io == 200

    # Slow outer planet: Neptune
    span_nep, steps_nep = calculate_trajectory_params("899", 30)
    assert span_nep == 3650.0
    assert steps_nep == 200

    # Full orbit requests use denser sampling
    span_earth_full, steps_earth_full = calculate_trajectory_params("399", 30, full_orbit=True)
    assert round(span_earth_full, 2) == 365.25
    assert steps_earth_full == 600
