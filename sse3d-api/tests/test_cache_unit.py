import pytest
import json
from app.models.schemas import EphemerisData
from unittest.mock import patch, AsyncMock

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
    
    with patch("app.services.cache_service.AsyncRedis") as mock_class:
        mock_redis = AsyncMock()
        mock_class.return_value = mock_redis
        mock_redis.get.return_value = raw_json
        
        cached, missing = await get_bulk_cached(["399"], "2024-01-01")
        
        assert len(cached) == 1
        assert cached[0].body_id == "399"
        assert len(missing) == 0

@pytest.mark.asyncio
async def test_get_bulk_cached_with_center_key():
    from app.services.cache_service import get_bulk_cached

    with patch("app.services.cache_service.AsyncRedis") as mock_class:
        mock_redis = AsyncMock()
        mock_class.return_value = mock_redis
        mock_redis.get.return_value = None

        cached, missing = await get_bulk_cached(["501"], "2024-01-01", center="599")

        mock_redis.get.assert_awaited_once_with("ephemeris:501:center_599:2024-01-01")
        assert cached == []
        assert missing == ["501"]
