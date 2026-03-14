import pytest
from unittest.mock import AsyncMock, patch
from app.models.schemas import EphemerisData, Position

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
    assert data["meta"]["source"] == "NASA_LIVE"

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
