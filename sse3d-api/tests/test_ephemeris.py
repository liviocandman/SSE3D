import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.models.schemas import EphemerisData, Position, OrbitLineProfile


def _mock_planet(body_id: str) -> EphemerisData:
    return EphemerisData(
        bodyId=body_id,
        name="Mock",
        position=Position(x=1.0, y=0.0, z=0.0),
        velocity=Position(x=0.0, y=0.0, z=0.0),
        timestamp="2024-01-01",
    )


@pytest.mark.asyncio
async def test_ephemeris_returns_data(client):
    with patch(
        "app.routers.ephemeris.fetch_all_spice",
        new_callable=AsyncMock,
        return_value=[_mock_planet("399")],
    ):
        response = await client.get("/api/ephemeris?date=2024-01-01&ids=399")

    assert response.status_code == 200
    data = response.json()
    assert len(data["data"]) == 1
    assert data["meta"]["source"] == "SPICE_KERNELS"


@pytest.mark.asyncio
async def test_ephemeris_with_center_body(client):
    with patch(
        "app.routers.ephemeris.fetch_all_spice",
        new_callable=AsyncMock,
        return_value=[_mock_planet("501")],
    ) as mock_fetch:
        response = await client.get(
            "/api/ephemeris?date=2024-01-01&ids=501&center_body=599"
        )

    assert response.status_code == 200
    mock_fetch.assert_called_once_with(
        ["501"],
        "2024-01-01",
        center_body="599",
        span_days=30,
        full_orbit=False,
        orbit_ready=False,
        orbit_profile=OrbitLineProfile.AUTO,
        orbit_line_only=False,
    )


@pytest.mark.asyncio
async def test_ephemeris_fallback_when_spice_missing(client):
    with patch(
        "app.routers.ephemeris.fetch_all_spice",
        new_callable=AsyncMock,
        return_value=[],
    ):
        response = await client.get("/api/ephemeris?date=2024-01-01&ids=399")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["source"] == "SPICE_AND_FALLBACK"
    assert len(payload["data"]) >= 1


@pytest.mark.asyncio
async def test_ephemeris_503_when_no_spice_and_no_fallback(client):
    with patch(
        "app.routers.ephemeris.fetch_all_spice",
        new_callable=AsyncMock,
        return_value=[],
    ):
        with patch(
            "app.routers.ephemeris.get_spice_runtime_status",
            return_value=SimpleNamespace(errors=["kernels missing"]),
        ):
            response = await client.get("/api/ephemeris?date=2024-01-01&ids=501")

    assert response.status_code == 503
    assert "SPICE kernels not ready" in response.json()["detail"]
