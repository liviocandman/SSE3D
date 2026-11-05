import asyncio
import threading
import time

import pytest

from app.services import spice_engine


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
            spice_engine.fetch_all_spice(["399"], "2026-11-04")
            for _ in range(8)
        )),
        timeout=5,
    )

    assert calls == 8
    assert responses == [[result]] * 8
    assert maximum_active == 1
