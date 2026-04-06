from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_get_artemis2_state_shape():
    response = client.get("/api/missions/artemis2/state")
    assert response.status_code == 200
    data = response.json()
    assert data["missionId"] == "artemis-2"
    # Mode must be one of the known modes
    assert data["mode"] in ["live", "predicted"]
    # Semantic consistency: if predicted, source must be predicted
    if data["mode"] == "predicted":
        assert data["source"] == "SPICE_PREDICTED"
    
    assert "position" in data
    assert "x" in data["position"]
    assert "globalCoordinates" in data
    assert "x" in data["globalCoordinates"]

def test_get_artemis2_state_replay():
    response = client.get("/api/missions/artemis2/state?at=2026-04-05T12:00:00Z")
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "replay"
    assert data["sourceTimestamp"] == "2026-04-05T12:00:00Z"
    assert data["missionElapsedTime"] == "3-22:00:00"
    assert data["phase"] in ["translunar_coast", "lunar_flyby", "return_coast", "reentry", "splashdown"]

def test_get_artemis2_trajectory_segments():
    response = client.get("/api/missions/artemis2/trajectory")
    assert response.status_code == 200
    data = response.json()
    assert "past" in data
    assert "planned" in data
    # Strict enum check for segments
    assert data["past"][0]["segment"] == "past"
    assert data["planned"][0]["segment"] == "planned"

def test_get_artemis2_trajectory_replay_timestamp():
    response = client.get("/api/missions/artemis2/trajectory?at=2026-04-05T12:00:00Z")
    assert response.status_code == 200
    data = response.json()
    assert "past" in data
    assert "planned" in data

def test_get_artemis2_events():
    response = client.get("/api/missions/artemis2/events")
    assert response.status_code == 200
    data = response.json()
    assert "events" in data
    assert len(data["events"]) > 0
    assert "currentPhase" in data

def test_get_artemis2_events_replay_timestamp():
    response = client.get("/api/missions/artemis2/events?at=2026-04-05T12:00:00Z")
    assert response.status_code == 200
    data = response.json()
    assert "currentPhase" in data
    if data.get("nextEvent"):
        assert data["nextEvent"]["timestamp"] >= "2026-04-05T12:00:00Z"

def test_get_artemis2_health_fields():
    response = client.get("/api/missions/artemis2/health")
    assert response.status_code == 200
    data = response.json()
    assert "currentSource" in data
    assert "fallbackActive" in data
    # Semantic check: if fallbackActive is True, status should be degraded or stale
    if data["fallbackActive"]:
        assert data["status"] in ["degraded", "stale"]
