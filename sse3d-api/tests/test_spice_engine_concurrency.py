import asyncio
import threading
import time

import pytest

from app.services import spice_engine
from app.models.schemas import OrbitLineProfile


@pytest.mark.asyncio
async def test_concurrent_requests_serialize_spice_computation(monkeypatch):
    active = 0
    maximum_active = 0
    calls = 0
    guard = threading.Lock()
    result = object()

    def compute(*args, **kwargs):
        nonlocal active, maximum_active, calls
        with guard:
            active += 1
            calls += 1
            maximum_active = max(maximum_active, active)
        try:
            # Release the GIL as native CSPICE does, exposing concurrent entry.
            time.sleep(0.03)
            return result
        finally:
            with guard:
                active -= 1

    monkeypatch.setattr(spice_engine, "compute_ephemeris", compute)

    responses = await asyncio.wait_for(
        asyncio.gather(*(
            spice_engine.fetch_all_spice(["399"], f"2026-11-{day:02d}")
            for day in range(1, 9)
        )),
        timeout=5,
    )

    assert calls == 8
    assert responses == [[result]] * 8
    assert maximum_active == 1


@pytest.mark.asyncio
async def test_equivalent_concurrent_requests_share_native_work(monkeypatch):
    calls = []

    def compute(body_id, **kwargs):
        calls.append(body_id)
        time.sleep(0.02)
        return body_id

    monkeypatch.setattr(spice_engine, "compute_ephemeris", compute)
    responses = await asyncio.wait_for(asyncio.gather(*(
        spice_engine.fetch_all_spice(ids, "2026-11-04")
        for ids in [["499", "399", "399"], ["399", "499"]] * 4
    )), timeout=5)

    assert calls == ["399", "499"]
    assert responses == [["399", "499"]] * 8
    assert not spice_engine._SPICE_REQUESTS


@pytest.mark.asyncio
@pytest.mark.parametrize("different_options", [
    {"target_date": "2026-11-05"},
    {"center_body": "599"},
    {"span_days": 60},
    {"full_orbit": True},
    {"orbit_ready": True},
    {"orbit_profile": OrbitLineProfile.RAPID},
    {"orbit_line_only": True},
])
async def test_different_computation_options_do_not_share_results(monkeypatch, different_options):
    calls = []

    def compute(body_id, **kwargs):
        calls.append(kwargs)
        time.sleep(0.01)
        return body_id

    monkeypatch.setattr(spice_engine, "compute_ephemeris", compute)
    first_options = {"target_date": "2026-11-04"}
    second_options = {**first_options, **different_options}
    await asyncio.wait_for(asyncio.gather(
        spice_engine.fetch_all_spice(["399"], **first_options),
        spice_engine.fetch_all_spice(["399"], **second_options),
    ), timeout=5)

    assert len(calls) == 2
    for option, value in different_options.items():
        assert any(call[option] == value for call in calls)


@pytest.mark.asyncio
async def test_cancellation_preserves_shared_job_and_capacity_until_native_exit(monkeypatch):
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def compute(*args, **kwargs):
        nonlocal calls
        calls += 1
        started.set()
        assert release.wait(timeout=5)
        return "399"

    monkeypatch.setattr(spice_engine, "compute_ephemeris", compute)
    monkeypatch.setattr(spice_engine, "MAX_SPICE_PENDING_REQUESTS", 1)
    first = asyncio.create_task(spice_engine.fetch_all_spice(["399"], "2026-11-04"))
    try:
        assert await asyncio.to_thread(started.wait, 2)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert len(spice_engine._SPICE_REQUESTS) == 1
        with pytest.raises(spice_engine.SpiceCapacityError):
            await spice_engine.fetch_all_spice(["499"], "2026-11-04")
        # A new equivalent waiter may still join the occupied slot.
        shared = asyncio.create_task(spice_engine.fetch_all_spice(["399"], "2026-11-04"))
        await asyncio.sleep(0)
    finally:
        release.set()

    assert await asyncio.wait_for(shared, 2) == ["399"]
    assert calls == 1
    assert not spice_engine._SPICE_REQUESTS
    assert await spice_engine.fetch_all_spice(["499"], "2026-11-04") == ["399"]


@pytest.mark.asyncio
async def test_failed_shared_job_releases_capacity_and_can_be_retried(monkeypatch):
    calls = 0

    def fail(*args):
        nonlocal calls
        calls += 1
        time.sleep(0.02)
        raise RuntimeError("worker failed")

    monkeypatch.setattr(spice_engine, "_fetch_all_spice_sync", fail)
    errors = await asyncio.gather(
        spice_engine.fetch_all_spice(["399"], "2026-11-04"),
        spice_engine.fetch_all_spice(["399"], "2026-11-04"),
        return_exceptions=True,
    )
    assert calls == 1
    assert all(isinstance(error, RuntimeError) for error in errors)
    assert not spice_engine._SPICE_REQUESTS
    monkeypatch.setattr(spice_engine, "_fetch_all_spice_sync", lambda *args: [])
    assert await spice_engine.fetch_all_spice(["399"], "2026-11-04") == []


@pytest.mark.asyncio
async def test_engine_rejects_oversized_batches_before_queueing():
    with pytest.raises(ValueError, match="At most"):
        await spice_engine.fetch_all_spice(["399"] * 33, "2026-11-04")
    assert not spice_engine._SPICE_REQUESTS
