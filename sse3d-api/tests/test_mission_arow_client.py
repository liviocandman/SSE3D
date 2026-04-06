import pytest
import respx
import httpx
from app.services.mission_arow_client import AROWClient
from app.core.config import settings

@pytest.mark.asyncio
async def test_arow_client_success():
    client = AROWClient()
    mock_payload = {"v": [{"id": "orion", "p": {"x": 100}}]}
    
    with respx.mock:
        respx.get(settings.arow_live_url).mock(return_value=httpx.Response(
            200, 
            json=mock_payload,
            headers={"ETag": "test-etag", "Last-Modified": "Wed, 01 Jan 2026 12:00:00 GMT"}
        ))
        
        result = await client.fetch_live_data()
        
        assert result["status_code"] == 200
        assert result["raw_payload"] == mock_payload
        assert result["headers"]["etag"] == "test-etag"
        assert "fetched_at" in result

@pytest.mark.asyncio
async def test_arow_client_http_error():
    client = AROWClient()
    
    with respx.mock:
        respx.get(settings.arow_live_url).mock(return_value=httpx.Response(500))
        
        with pytest.raises(httpx.HTTPStatusError):
            await client.fetch_live_data()

@pytest.mark.asyncio
async def test_arow_client_timeout():
    client = AROWClient()
    
    with respx.mock:
        respx.get(settings.arow_live_url).mock(side_effect=httpx.TimeoutException("Timeout"))
        
        with pytest.raises(httpx.TimeoutException):
            await client.fetch_live_data()
