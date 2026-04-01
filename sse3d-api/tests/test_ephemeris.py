import pytest
from unittest.mock import AsyncMock, patch
from app.models.schemas import EphemerisData, Position
from app.services.nasa_client import calculate_trajectory_params

def _mock_planet(body_id: str) -> EphemerisData:
    return EphemerisData(
        bodyId=body_id, name="Mock",
        position=Position(x=1.0, y=0.0, z=0.0),
        timestamp="2024-01-01",
    )

@pytest.mark.asyncio
async def test_ephemeris_returns_data(client):
    with patch("app.routers.ephemeris.get_bulk_cached",
               return_value=([], ["399"])):
        with patch("app.routers.ephemeris.fetch_all_parallel",
                   new_callable=AsyncMock,
                   return_value=[_mock_planet("399")]):
            with patch("app.routers.ephemeris.set_bulk_cached",
                       new_callable=AsyncMock):
                response = await client.get("/api/ephemeris?date=2024-01-01")

    assert response.status_code == 200
    data = response.json()
    assert len(data["data"]) == 1
    assert data["meta"]["source"] == "NASA_LIVE_AND_CACHE"

@pytest.mark.asyncio
async def test_ephemeris_cache_hit(client):
    with patch("app.routers.ephemeris.get_bulk_cached",
               return_value=([_mock_planet("399")], [])):
        with patch("app.routers.ephemeris.fetch_all_parallel",
                   new_callable=AsyncMock) as mock_fetch:
            response = await client.get("/api/ephemeris?date=2024-01-01&ids=399")

    assert response.status_code == 200
    mock_fetch.assert_not_called()
    assert response.json()["meta"]["source"] == "CACHE_HIT"

@pytest.mark.asyncio
async def test_ephemeris_with_center_body(client):
    with patch("app.routers.ephemeris.get_bulk_cached",
               return_value=([], ["199"])) as mock_cache_get:
        with patch("app.routers.ephemeris.fetch_all_parallel",
                   new_callable=AsyncMock,
                   return_value=[_mock_planet("199")]) as mock_fetch:
            with patch("app.routers.ephemeris.set_bulk_cached",
                       new_callable=AsyncMock) as mock_cache_set:
                response = await client.get(
                    "/api/ephemeris?date=2024-01-01&ids=199&center_body=599"
                )

    assert response.status_code == 200
    mock_cache_get.assert_called_once_with(["199"], "2024-01-01_30", center="599")
    mock_fetch.assert_called_once_with(
        ["199"], "2024-01-01", center_body="599", span_days=30, full_orbit=False
    )
    mock_cache_set.assert_called_once()


def test_dynamic_payload_generation():
    # Fast moon: Io (501) - 1.769 days period
    # Span should be 1.769 * 1.1 = 1.9459 days
    # roughly 46.7 hours -> step size should be 46.7 / 200 = 0.23 hours = 14 mins
    span, step_size = calculate_trajectory_params("501", 30)
    assert round(span, 3) == 1.946
    # 1.9459 * 24 = 46.7 hours. 46.7 * 60 = 2802 mins. 2802 / 200 = 14 mins.
    assert "m" in step_size or "h" in step_size

    # Slow planet: Neptune (899) - 60189.0 days period
    # Span should be min(60189.0 / 12.0, 3650.0) = 3650.0 days
    # Total hours: 3650.0 * 24 = 87600 hours
    # step_hours: 87600 / 200 = 438 hours -> 438 / 24 = 18 days
    span_nep, step_size_nep = calculate_trajectory_params("899", 30)
    assert span_nep == 3650.0
    assert step_size_nep == "18 d"

    # Both target roughly 200 points.

@pytest.mark.asyncio
async def test_cache_isolation(client):
    with patch("app.routers.ephemeris.get_bulk_cached",
               return_value=([], ["399"])) as mock_cache_get:
        with patch("app.routers.ephemeris.fetch_all_parallel",
                   new_callable=AsyncMock,
                   return_value=[_mock_planet("399")]):
            with patch("app.routers.ephemeris.set_bulk_cached",
                       new_callable=AsyncMock) as mock_cache_set:
                response = await client.get("/api/ephemeris?date=2024-01-01&ids=399&spanDays=60")

    assert response.status_code == 200
    mock_cache_get.assert_called_once_with(["399"], "2024-01-01_60", center="10")
    mock_cache_set.assert_called_once()

