import pytest
from app.services.mission_normalizer import (
    normalize_arow_live_payload,
    calculate_staleness,
    normalize_timestamp,
    create_mission_health,
)
from app.models.mission_schemas import MissionDataSource, MissionPhase

def test_normalize_arow_payload_basic():
    raw_payload = {
        "missionId": "artemis-2",
        "v": [{
            "id": "orion",
            "p": {"x": 100, "y": 200, "z": 300},
            "v": {"vx": 1, "vy": 2, "vz": 3},
            "t": "2026-04-03T12:00:00Z",
            "ph": "translunar_coast",
            "met": "1-00:00:00",
            "d": {"e": 50000, "m": 350000}
        }]
    }
    headers = {"etag": "xyz"}
    fetched_at = "2026-04-03T12:05:00Z"
    
    state = normalize_arow_live_payload(raw_payload, headers, fetched_at)
    
    assert state.mission_id == "artemis-2"
    assert state.vehicle_id == "orion"
    assert state.position.x == 100
    assert state.velocity.x == 1
    assert state.phase == MissionPhase.TRANSLUNAR_COAST
    assert state.source == MissionDataSource.AROW_LIVE
    assert state.distances.earth_km == 50000
    assert state.source_timestamp == "2026-04-03T12:00:00Z"

def test_normalize_arow_payload_flat_resilience():
    # Test resilience to flat structure and different naming
    raw_payload = {
        "mission_id": "artemis-2",
        "vehicles": [{
            "id": "ORION",
            "x": 1000, "y": 2000, "z": 3000,
            "vx": 10, "vy": 20, "vz": 30,
            "phase": "launch",
            "earth_km": 100, "moon_km": 400000
        }]
    }
    state = normalize_arow_live_payload(raw_payload, {}, "2026-04-03T12:00:00Z")
    assert state.position.x == 1000
    assert state.velocity.z == 30
    assert state.phase == MissionPhase.LAUNCH
    assert state.distances.moon_km == 400000

def test_normalize_arow_payload_doy_timestamp():
    raw_payload = {
        "missionId": "artemis-2",
        "vehicles": [{
            "id": "ORION",
            "x": 1000,
            "y": 2000,
            "z": 3000,
            "vx": 10,
            "vy": 20,
            "vz": 30,
            "timestamp": "2026:093:13:10:14",
            "phase": "launch",
            "earth_km": 100,
            "moon_km": 400000,
        }]
    }
    state = normalize_arow_live_payload(raw_payload, {}, "2026-04-03T13:11:13Z")
    assert state.source_timestamp == "2026-04-03T13:10:14Z"
    assert state.phase == MissionPhase.LAUNCH

def test_normalize_operational_parameter_payload():
    raw_payload = {
        "mission_id": "artemis-2",
        "vehicles": [{
            "id": "ORION",
            "Parameter_2003": "2026:093:13:10:14",
            "Parameter_2004": "2-04:30:15",
            "Parameter_3001": "150000.1",
            "Parameter_3002": "200000.4",
            "Parameter_3003": "50000.8",
            "Parameter_3004": "1.21",
            "Parameter_3005": "-0.52",
            "Parameter_3006": "0.10",
            "Parameter_5001": "250000.0",
            "Parameter_5002": "130000.0",
        }]
    }
    state = normalize_arow_live_payload(raw_payload, {}, "2026-04-03T13:11:13Z")
    assert state.position.x == 150000.1
    assert state.velocity.y == -0.52
    assert state.distances.earth_km == 250000.0
    assert state.source_timestamp == "2026-04-03T13:10:14Z"

def test_normalize_timestamp_doy_to_iso():
    iso_value, fmt = normalize_timestamp("2026:093:13:10:14")
    assert iso_value == "2026-04-03T13:10:14Z"
    assert fmt == "doy"

def test_calculate_staleness_uses_last_modified_when_no_source_timestamp():
    value = calculate_staleness(
        None,
        {"last-modified": "Fri, 03 Apr 2026 13:11:13 GMT"},
        "2026-04-03T13:11:20Z",
    )
    assert value >= 0

def test_calculate_staleness_uses_age_when_no_timestamp_or_last_modified():
    value = calculate_staleness(
        None,
        {"age": "17"},
        "2026-04-03T13:11:20Z",
    )
    assert value == 17.0

def test_create_mission_health_enriches_details():
    raw_payload = {
        "missionId": "artemis-2",
        "vehicles": [{
            "id": "ORION",
            "timestamp": "2026:093:13:10:14",
            "x": 1,
            "y": 2,
            "z": 3,
        }]
    }
    headers = {
        "etag": "abc",
        "last-modified": "Fri, 03 Apr 2026 13:11:13 GMT",
        "cache-control": "public, max-age=15",
        "age": "5",
        "content-type": "application/json",
    }
    state = normalize_arow_live_payload(raw_payload, headers, "2026-04-03T13:11:20Z")
    health = create_mission_health(state, headers, "2026-04-03T13:11:20Z", raw_payload=raw_payload)
    assert health.details["rawSourceType"] == "nested_vehicles"
    assert health.details["timeFormatDetected"] == "doy"
    assert health.details["parserVersion"] == "epic1-final"
    assert health.details["cacheControl"] == "public, max-age=15"

def test_normalize_empty_vehicles():
    with pytest.raises(ValueError, match="No vehicles list found"):
        normalize_arow_live_payload({"v": []}, {}, "2026-04-03T12:00:00Z")
