import pytest
from unittest.mock import AsyncMock, patch

from app.models.schemas import EphemerisData, OrbitLineProfile, Position


def _mock_moon(body_id: str) -> EphemerisData:
    return EphemerisData(
        bodyId=body_id,
        name="Mock Moon",
        position=Position(x=1.0, y=0.0, z=0.0),
        velocity=Position(x=0.0, y=0.0, z=0.0),
        timestamp="2026-04-08",
        trajectory=[],
    )


@pytest.mark.asyncio
async def test_ephemeris_orbit_ready_param(client):
    with patch("app.routers.ephemeris.get_bulk_cached", new_callable=AsyncMock, return_value=([], ["401"])):
        with patch("app.routers.ephemeris.set_bulk_cached", new_callable=AsyncMock):
            with patch(
                "app.routers.ephemeris.fetch_all_spice",
                new_callable=AsyncMock,
                return_value=[_mock_moon("401")],
            ) as mock_fetch:
                response = await client.get("/api/ephemeris?date=2026-04-08&ids=401&orbitReady=true&orbitProfile=rapid")

    assert response.status_code == 200
    mock_fetch.assert_called_once_with(
        ["401"],
        "2026-04-08",
        center_body="10",
        span_days=30,
        full_orbit=False,
        orbit_ready=True,
        orbit_profile=OrbitLineProfile.RAPID,
        orbit_line_only=False,
    )


@pytest.mark.asyncio
async def test_ephemeris_orbit_ready_defaults(client):
    with patch("app.routers.ephemeris.get_bulk_cached", new_callable=AsyncMock, return_value=([], ["401"])):
        with patch("app.routers.ephemeris.set_bulk_cached", new_callable=AsyncMock):
            with patch(
                "app.routers.ephemeris.fetch_all_spice",
                new_callable=AsyncMock,
                return_value=[_mock_moon("401")],
            ) as mock_fetch:
                response = await client.get("/api/ephemeris?date=2026-04-08&ids=401")

    assert response.status_code == 200
    mock_fetch.assert_called_once_with(
        ["401"],
        "2026-04-08",
        center_body="10",
        span_days=30,
        full_orbit=False,
        orbit_ready=False,
        orbit_profile=OrbitLineProfile.AUTO,
        orbit_line_only=False,
    )


@pytest.mark.asyncio
async def test_ephemeris_invalid_profile(client):
    response = await client.get("/api/ephemeris?ids=401&orbitProfile=invalid")
    assert response.status_code == 422  # Pydantic validation error for Enum


@pytest.mark.asyncio
async def test_ephemeris_orbit_ready_respects_feature_gate(client):
    with patch("app.routers.ephemeris.settings") as mock_settings:
        mock_settings.orbit_ready_enabled = False
        with patch("app.routers.ephemeris.get_bulk_cached", new_callable=AsyncMock, return_value=([], ["401"])):
            with patch("app.routers.ephemeris.set_bulk_cached", new_callable=AsyncMock):
                with patch(
                    "app.routers.ephemeris.fetch_all_spice",
                    new_callable=AsyncMock,
                    return_value=[_mock_moon("401")],
                ) as mock_fetch:
                    response = await client.get("/api/ephemeris?date=2026-04-08&ids=401&orbitReady=true")

    assert response.status_code == 200
    mock_fetch.assert_called_once_with(
        ["401"],
        "2026-04-08",
        center_body="10",
        span_days=30,
        full_orbit=False,
        orbit_ready=False,
        orbit_profile=OrbitLineProfile.AUTO,
        orbit_line_only=False,
    )


@pytest.mark.asyncio
async def test_ephemeris_orbit_ready_rejects_partial_response(client):
    with patch("app.routers.ephemeris.settings") as mock_settings:
        mock_settings.orbit_ready_enabled = True
        with patch("app.routers.ephemeris.get_bulk_cached", new_callable=AsyncMock, return_value=([], ["401", "402"])):
            with patch("app.routers.ephemeris.set_bulk_cached", new_callable=AsyncMock):
                with patch(
                    "app.routers.ephemeris.fetch_all_spice",
                    new_callable=AsyncMock,
                    return_value=[_mock_moon("401")],
                ):
                    response = await client.get("/api/ephemeris?date=2026-04-08&ids=401,402&orbitReady=true")

    assert response.status_code == 503
    assert "Orbit-ready data unavailable for IDs: 402" in response.json()["detail"]


@pytest.mark.asyncio
async def test_ephemeris_orbit_line_only_param(client):
    with patch("app.routers.ephemeris.get_bulk_cached", new_callable=AsyncMock, return_value=([], ["401"])):
        with patch("app.routers.ephemeris.set_bulk_cached", new_callable=AsyncMock):
            with patch(
                "app.routers.ephemeris.fetch_all_spice",
                new_callable=AsyncMock,
                return_value=[_mock_moon("401")],
            ) as mock_fetch:
                response = await client.get("/api/ephemeris?date=2026-04-08&ids=401&orbitReady=true&orbitLineOnly=true")

    assert response.status_code == 200
    mock_fetch.assert_called_once_with(
        ["401"],
        "2026-04-08",
        center_body="10",
        span_days=30,
        full_orbit=False,
        orbit_ready=True,
        orbit_profile=OrbitLineProfile.AUTO,
        orbit_line_only=True,
    )
