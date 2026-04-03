from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_get_artemis2_state():
    response = client.get("/api/missions/artemis2/state")
    assert response.status_code == 200
    data = response.json()
    assert data["missionId"] == "artemis-2"
    assert data["mode"] == "live"
    assert "position" in data
    assert data["globalCoordinates"] == {"x": 150000.0, "y": 200000.0, "z": 50000.0}
    assert data["missionCoordinates"] == {"x": 150000.0, "y": 200000.0, "z": 50000.0}

def test_get_artemis2_state_replay():
    response = client.get("/api/missions/artemis2/state?at=2026-04-05T12:00:00Z")
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "replay"
    assert data["sourceTimestamp"] == "2026-04-05T12:00:00Z"

def test_get_artemis2_trajectory():
    response = client.get("/api/missions/artemis2/trajectory")
    assert response.status_code == 200
    data = response.json()
    assert "past" in data
    assert "planned" in data
    assert data["past"][0]["segment"] == "past"
    assert data["planned"][0]["segment"] == "planned"

def test_get_artemis2_events():
    response = client.get("/api/missions/artemis2/events")
    assert response.status_code == 200
    data = response.json()
    assert "events" in data
    assert len(data["events"]) > 0

def test_get_artemis2_health():
    response = client.get("/api/missions/artemis2/health")
    assert response.status_code == 200
    data = response.json()
    assert data["currentSource"] == "AROW_LIVE"
    assert data["fallbackActive"] is False
    assert "coverageStart" in data
    assert "coverageEnd" in data
