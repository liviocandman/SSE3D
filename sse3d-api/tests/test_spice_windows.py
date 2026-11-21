from app.services.spice_windows import resolve_target_observer


def test_dynamic_outer_planets_use_physical_centers_from_sun():
    for body_id in ("599", "699", "799", "899", "999"):
        assert resolve_target_observer(body_id) == (body_id, "10")


def test_full_orbit_outer_planets_keep_system_barycenters():
    for body_id in ("599", "699", "799", "899", "999"):
        assert resolve_target_observer(body_id, full_orbit=True) == (
            body_id[0], "10"
        )


def test_moon_states_remain_relative_to_physical_parent():
    assert resolve_target_observer("501") == ("501", "599")
    assert resolve_target_observer("606") == ("606", "699")
