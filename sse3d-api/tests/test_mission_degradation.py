import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.models.mission_schemas import MissionDataSource, MissionHealthResponse

client = TestClient(app)

@pytest.mark.asyncio
async def test_health_reflects_live_cache():
    mock_health = MissionHealthResponse(
        missionId="artemis-2",
        currentSource=MissionDataSource.AROW_LIVE,
        lastUpdate="2026-04-04T12:00:00Z",
        dataAgeSeconds=10.0,
        fallbackActive=False,
        status="nominal"
    )
    
    with patch("app.services.mission_cache_service.MissionCacheService.get_live_state", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = (None, mock_health)
        response = client.get("/api/missions/artemis2/health")
        
    assert response.status_code == 200
    data = response.json()
    assert data["currentSource"] == "AROW_LIVE"
    assert data["fallbackActive"] is False
    assert data["status"] == "nominal"

@pytest.mark.asyncio
async def test_health_reflects_degraded_fallback():
    mock_last_good = MissionHealthResponse(
        missionId="artemis-2",
        currentSource=MissionDataSource.AROW_LIVE,
        lastUpdate="2026-04-04T11:00:00Z",
        dataAgeSeconds=3600.0,
        fallbackActive=False,
        status="nominal"
    )
    
    with patch("app.services.mission_cache_service.MissionCacheService.get_live_state", new_callable=AsyncMock) as mock_live:
        mock_live.return_value = (None, None)
        with patch("app.services.mission_cache_service.MissionCacheService.get_last_good_state", new_callable=AsyncMock) as mock_fallback:
            mock_fallback.return_value = (None, mock_last_good)
            response = client.get("/api/missions/artemis2/health")
            
    assert response.status_code == 200
    data = response.json()
    assert data["fallbackActive"] is True
    assert data["status"] == "degraded"

@pytest.mark.asyncio
async def test_state_degradation_on_arow_failure():
    # Mock AROW failure
    with patch("app.services.mission_arow_client.AROWClient.fetch_live_data", side_effect=Exception("API Down")):
        # Mock no cache
        with patch("app.services.mission_cache_service.MissionCacheService.get_live_state", new_callable=AsyncMock) as mock_live:
            mock_live.return_value = (None, None)
            with patch("app.services.mission_cache_service.MissionCacheService.get_last_good_state", new_callable=AsyncMock) as mock_fallback:
                mock_fallback.return_value = (None, None)
                
                response = client.get("/api/missions/artemis2/state")
                
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "predicted"
    assert data["source"] == "SPICE_PREDICTED"

@pytest.mark.asyncio
async def test_recovery_to_nominal():
    mock_health = MissionHealthResponse(
        missionId="artemis-2",
        currentSource=MissionDataSource.AROW_LIVE,
        lastUpdate="2026-04-04T12:00:00Z",
        dataAgeSeconds=10.0,
        fallbackActive=False,
        status="nominal"
    )
    
    # 1. Simulate Fallback (No live cache, has last good)
    with patch("app.services.mission_cache_service.MissionCacheService.get_live_state", new_callable=AsyncMock) as mock_live:
        mock_live.return_value = (None, None)
        with patch("app.services.mission_cache_service.MissionCacheService.get_last_good_state", new_callable=AsyncMock) as mock_fallback:
            mock_fallback.return_value = (None, mock_health)
            
            # This should report fallback/degraded
            response = client.get("/api/missions/artemis2/health")
            assert response.json()["fallbackActive"] is True
            assert response.json()["status"] == "degraded"

    # 2. Simulate Recovery (Live cache now has data)
    with patch("app.services.mission_cache_service.MissionCacheService.get_live_state", new_callable=AsyncMock) as mock_live:
        mock_live.return_value = (None, mock_health)
        
        # This should report nominal again
        response = client.get("/api/missions/artemis2/health")
        assert response.json()["fallbackActive"] is False
        assert response.json()["status"] == "nominal"
