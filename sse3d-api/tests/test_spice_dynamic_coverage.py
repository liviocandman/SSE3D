from datetime import datetime, timedelta

import numpy as np
import pytest
from spiceypy.utils.exceptions import SpiceSPKINSUFFDATA

from app.services import spice_engine


EPOCH = datetime(2000, 1, 1)
DAY = 86_400
WINDOWS = {"599": [(0, 2 * DAY)], "5": [(-100 * DAY, 100 * DAY)]}


@pytest.fixture
def coverage_spice(monkeypatch):
    def state(target, times, frame, correction, observer):
        assert (frame, correction, observer) == ("ECLIPJ2000", "NONE", "10")
        if any(not any(start <= time <= end for start, end in WINDOWS[target]) for time in np.atleast_1d(times)):
            raise SpiceSPKINSUFFDATA()
        # Distinguish physical positions from barycentric positions directly.
        result = np.zeros((*np.shape(times), 6))
        result[..., 0] = float(target)
        return result, 0

    monkeypatch.setattr(spice_engine, "assert_spice_ready", lambda: None)
    monkeypatch.setattr("app.services.spice_kernel_manager._status.coverage_windows_et", WINDOWS)
    monkeypatch.setattr(spice_engine.spice, "str2et", lambda time: (datetime.fromisoformat(time) - EPOCH).total_seconds())
    monkeypatch.setattr(spice_engine.spice, "spkezr", state)
    monkeypatch.setattr(spice_engine, "_et_to_iso_z", lambda time: (EPOCH + timedelta(seconds=time)).isoformat(timespec="milliseconds") + "Z")


@pytest.mark.usefixtures("coverage_spice")
@pytest.mark.parametrize(("date", "first", "last"), [
    ("2000-01-02", "2000-01-01", "2000-01-02"),
    ("2000-01-01", "2000-01-01", "2000-01-01"),
])
def test_physical_trajectory_is_clipped_to_coverage(date, first, last):
    body = spice_engine.compute_ephemeris("599", date)
    assert body is not None
    assert body.reference_center is None
    assert body.position.x == 599
    assert body.trajectory[0].timestamp == f"{first}T00:00:00.000Z"
    assert body.trajectory[-1].timestamp == f"{last}T00:00:00.000Z"
    assert len(body.trajectory) == len({point.timestamp for point in body.trajectory})
    assert all(point.position.x == 599 for point in body.trajectory)
    [earlier] = body.additional_trajectories
    assert earlier.reference_center == "system_barycenter"
    assert earlier.trajectory[-1].timestamp == "1999-12-31T23:59:59.999Z"
    assert all(point.position.x == 5 for point in earlier.trajectory)


@pytest.mark.usefixtures("coverage_spice")
@pytest.mark.parametrize(("date", "first"), [
    ("1999-12-31", "1999-12-01T00:00:00.000Z"),
    ("2000-01-04", "2000-01-03T00:00:00.001Z"),
])
def test_barycentric_trajectory_stays_outside_physical_coverage(date, first):
    body = spice_engine.compute_ephemeris("599", date)
    assert body is not None
    assert body.reference_center == "system_barycenter"
    assert body.position.x == 5
    assert body.trajectory[0].timestamp == first
    assert body.trajectory[-1].timestamp == f"{date}T00:00:00.000Z"
    assert all(point.position.x == 5 for point in body.trajectory)
    if date == "2000-01-04":
        earlier_barycentric, physical = body.additional_trajectories
        assert earlier_barycentric.reference_center == "system_barycenter"
        assert earlier_barycentric.trajectory[-1].timestamp == "1999-12-31T23:59:59.999Z"
        assert all(point.position.x == 5 for point in earlier_barycentric.trajectory)
        assert physical.reference_center is None
        assert physical.trajectory[0].timestamp == "2000-01-01T00:00:00.000Z"
        assert physical.trajectory[-1].timestamp == "2000-01-03T00:00:00.000Z"
        assert all(point.position.x == 599 for point in physical.trajectory)
    else:
        assert body.additional_trajectories is None
