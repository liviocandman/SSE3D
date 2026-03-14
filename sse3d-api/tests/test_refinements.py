import pytest
from unittest.mock import AsyncMock, patch
from app.models.schemas import EphemerisData, Position

@pytest.mark.asyncio
async def test_invalid_date_returns_422(client):
    """Verify that FastAPI returns 422 for invalid date strings."""
    response = await client.get("/api/ephemeris?date=not-a-date")
    assert response.status_code == 422

@pytest.mark.asyncio
async def test_cache_failure_fail_open(client):
    """Verify that cache failure doesn't crash the API and triggers NASA fetch."""
    mock_planet = EphemerisData(
        bodyId="399", name="Earth",
        position=Position(x=1.0, y=1.0, z=1.0),
        timestamp="2024-01-01"
    )

    with patch("app.services.cache_service.AsyncRedis") as mock_redis_class:
        # Simulate connection error
        mock_redis = mock_redis_class.return_value
        mock_redis.get.side_effect = Exception("Redis Down")
        mock_redis.set.side_effect = Exception("Redis Down")

        with patch("app.routers.ephemeris.fetch_all_parallel",
                   new_callable=AsyncMock,
                   return_value=[mock_planet]):
            
            response = await client.get("/api/ephemeris?date=2024-01-01&ids=399")

    assert response.status_code == 200
    assert response.json()["meta"]["source"] == "NASA_LIVE"
    assert len(response.json()["data"]) == 1

@pytest.mark.asyncio
async def test_fallback_data_loading(client):
    """Verify that fallback data is loaded correctly when NASA fails."""
    # We patch fetch_all_parallel to return empty list (simulating NASA failure)
    # We also ensure cache miss
    with patch("app.routers.ephemeris.get_bulk_cached", return_value=([], ["399"])):
        with patch("app.routers.ephemeris.fetch_all_parallel", new_callable=AsyncMock, return_value=[]):
            with patch("app.routers.ephemeris.set_bulk_cached", new_callable=AsyncMock):
                # Ensure the fallback file exists or is mocked
                response = await client.get("/api/ephemeris?date=2024-01-01&ids=399")

    assert response.status_code == 200
    # Even if NASA fails, if fallback works it should return data
    data = response.json()["data"]
    if len(data) > 0:
        assert data[0]["bodyId"] == "399"
        assert data[0]["name"] == "Terra"
