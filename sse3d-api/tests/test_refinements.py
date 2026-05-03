import pytest
from unittest.mock import AsyncMock, patch

from app.models.schemas import EphemerisData, Position


@pytest.mark.asyncio
async def test_invalid_date_returns_422(client):
    response = await client.get("/api/ephemeris?date=not-a-date")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_spice_path_returns_200(client):
    mock_planet = EphemerisData(
        bodyId="399",
        name="Earth",
        position=Position(x=1.0, y=1.0, z=1.0),
        velocity=Position(x=0.0, y=0.0, z=0.0),
        timestamp="2024-01-01",
    )

    with patch(
        "app.routers.ephemeris.fetch_all_spice",
        new_callable=AsyncMock,
        return_value=[mock_planet],
    ):
        response = await client.get("/api/ephemeris?date=2024-01-01&ids=399")

    assert response.status_code == 200
    assert response.json()["meta"]["source"] == "SPICE_KERNELS"
    assert len(response.json()["data"]) == 1


@pytest.mark.asyncio
async def test_fallback_data_loading(client):
    with patch(
        "app.routers.ephemeris.get_bulk_cached",
        new_callable=AsyncMock,
        return_value=([], ["399"]),
    ):
        with patch(
            "app.routers.ephemeris.fetch_all_spice",
            new_callable=AsyncMock,
            return_value=[],
        ):
            response = await client.get("/api/ephemeris?date=2024-01-01&ids=399")

    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) > 0
    assert response.json()["meta"]["source"] == "SPICE_AND_FALLBACK"
