from app.models.mission_schemas import (
    MissionDataSource,
    MissionMode,
    MissionPhase,
    MissionTrajectorySegment,
    MissionStateResponse,
    MissionTrajectoryResponse,
    MissionEventsResponse,
    MissionHealthResponse
)

def test_mission_enums():
    assert MissionDataSource.AROW_LIVE == "AROW_LIVE"
    assert MissionMode.LIVE == "live"
    assert MissionPhase.LAUNCH == "launch"

def test_mission_state_serialization():
    data = {
        "missionId": "artemis-2",
        "vehicleId": "orion",
        "mode": "live",
        "phase": "translunar_coast",
        "source": "AROW_LIVE",
        "sourceTimestamp": "2026-04-03T12:00:00Z",
        "stalenessSeconds": 0.5,
        "position": {"x": 1.0, "y": 2.0, "z": 3.0},
        "velocity": {"x": 0.1, "y": 0.2, "z": 0.3},
        "distances": {"earthKm": 1000.0, "moonKm": 500.0},
        "missionElapsedTime": "1-02:03:04",
        "globalCoordinates": {"x": 1.0, "y": 2.0, "z": 3.0},
        "missionCoordinates": {"x": 4.0, "y": 5.0, "z": 6.0},
        "solarRangeKm": 149600000.0,
        "lineOfSightStatus": "lunar_occultation",
    }
    response = MissionStateResponse(**data)
    serialized = response.model_dump(by_alias=True)
    assert serialized["missionId"] == "artemis-2"
    assert serialized["sourceTimestamp"] == "2026-04-03T12:00:00Z"
    assert serialized["distances"]["earthKm"] == 1000.0
    assert serialized["globalCoordinates"]["x"] == 1.0
    assert serialized["missionCoordinates"]["z"] == 6.0
    assert serialized["solarRangeKm"] == 149600000.0
    assert serialized["lineOfSightStatus"] == "lunar_occultation"

def test_mission_trajectory_serialization():
    data = {
        "missionId": "artemis-2",
        "past": [
            {
                "timestamp": "2026-04-03T10:00:00Z",
                "position": {"x": 0, "y": 0, "z": 0},
                "segment": "past"
            }
        ],
        "planned": []
    }
    response = MissionTrajectoryResponse(**data)
    assert response.mission_id == "artemis-2"
    assert len(response.past) == 1
    assert response.past[0].segment == MissionTrajectorySegment.PAST

def test_mission_events_serialization():
    data = {
        "missionId": "artemis-2",
        "events": [
            {
                "id": "1",
                "name": "Launch",
                "description": "desc",
                "timestamp": "2026-04-01T00:00:00Z",
                "phase": "launch",
                "isCompleted": True
            }
        ],
        "currentPhase": "launch"
    }
    response = MissionEventsResponse(**data)
    assert response.current_phase == MissionPhase.LAUNCH
    assert response.events[0].is_completed is True

def test_mission_health_serialization():
    data = {
        "missionId": "artemis-2",
        "currentSource": "AROW_LIVE",
        "lastUpdate": "2026-04-03T12:00:00Z",
        "dataAgeSeconds": 0.5,
        "fallbackActive": False,
        "coverageStart": "2026-04-01T14:00:00Z",
        "coverageEnd": "2026-04-11T11:00:00Z",
    }
    response = MissionHealthResponse(**data)
    serialized = response.model_dump(by_alias=True)
    assert serialized["currentSource"] == "AROW_LIVE"
    assert serialized["fallbackActive"] is False
    assert serialized["coverageStart"] == "2026-04-01T14:00:00Z"
