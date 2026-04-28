import pytest
import json
from app.models.schemas import EphemerisData
from unittest.mock import patch, AsyncMock
from app.models.schemas import OrbitLineProfile

def test_ephemeris_data_deserialization_with_alias():
    # Isso simula o dado vindo do Redis com bodyId (alias)
    raw_json = '{"bodyId": "399", "name": "Earth", "position": {"x": 1, "y": 2, "z": 3}, "timestamp": "2024-01-01"}'
    data_dict = json.loads(raw_json)
    
    # Isso deve funcionar usando model_validate
    obj = EphemerisData.model_validate(data_dict)
    assert obj.body_id == "399"
    assert obj.name == "Earth"

@pytest.mark.asyncio
async def test_get_bulk_cached_deserialization():
    from app.services.cache_service import get_bulk_cached
    
    raw_json = '{"bodyId": "399", "name": "Earth", "position": {"x": 1, "y": 2, "z": 3}, "timestamp": "2024-01-01"}'
    
    with patch("app.services.cache_service.get_redis") as mock_get_redis:
        mock_redis = AsyncMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.get.return_value = raw_json
        
        cached, missing = await get_bulk_cached(["399"], "2024-01-01")
        
        assert len(cached) == 1
        assert cached[0].body_id == "399"
        assert len(missing) == 0

@pytest.mark.asyncio
async def test_get_bulk_cached_with_center_key():
    from app.services.cache_service import get_bulk_cached

    with patch("app.services.cache_service.get_redis") as mock_get_redis:
        mock_redis = AsyncMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.get.return_value = None

        cached, missing = await get_bulk_cached(["501"], "2024-01-01", center="599")

        mock_redis.get.assert_awaited_once_with("ephemeris:501:center_599:2024-01-01:span_30")
        assert cached == []
        assert missing == ["501"]

@pytest.mark.asyncio
async def test_get_bulk_cached_orbit_ready_requires_orbit_line():
    from app.services.cache_service import get_bulk_cached

    raw_json_without_orbit_line = '{"bodyId": "401", "name": "Phobos", "position": {"x": 1, "y": 2, "z": 3}, "timestamp": "2024-01-01"}'

    with patch("app.services.cache_service.get_redis") as mock_get_redis:
        mock_redis = AsyncMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.get.return_value = raw_json_without_orbit_line

        cached, missing = await get_bulk_cached(
            ["401"],
            "2024-01-01",
            orbit_ready=True,
            orbit_profile=OrbitLineProfile.AUTO,
        )

        assert cached == []
        assert missing == ["401"]

@pytest.mark.asyncio
async def test_get_bulk_cached_orbit_line_only_uses_specific_cache_key():
    from app.services.cache_service import get_bulk_cached

    with patch("app.services.cache_service.get_redis") as mock_get_redis:
        mock_redis = AsyncMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.get.return_value = None

        await get_bulk_cached(
            ["401"],
            "2024-01-01",
            orbit_ready=True,
            orbit_profile=OrbitLineProfile.RAPID,
            orbit_line_only=True,
        )

        mock_redis.get.assert_awaited_once_with(
            "ephemeris:401:2024-01-01:span_30:orbit_ready_orbit-ready-v1:profile_rapid:orbit_line_only"
        )

@pytest.mark.asyncio
async def test_get_bulk_cached_full_orbit_uses_distinct_cache_key():
    from app.services.cache_service import get_bulk_cached

    with patch("app.services.cache_service.get_redis") as mock_get_redis:
        mock_redis = AsyncMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.get.return_value = None

        await get_bulk_cached(
            ["301"],
            "2024-01-01",
            span_days=30,
            full_orbit=True,
        )

        mock_redis.get.assert_awaited_once_with(
            "ephemeris:301:2024-01-01:span_30:full_orbit"
        )
