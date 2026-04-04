from fastapi import APIRouter, Query, HTTPException
from datetime import datetime, timezone
from typing import Optional
from loguru import logger

from app.models.mission_schemas import (
    MissionStateResponse, 
    MissionTrajectoryResponse, 
    MissionEventsResponse, 
    MissionHealthResponse,
    MissionPhase,
    MissionDataSource,
    MissionPosition,
    MissionVelocity,
    MissionDistances,
    MissionEvent,
    MissionTrajectoryPoint,
    MissionCoordinates,
    MissionTrajectorySegment
)
from app.services.mission_data_service import (
    get_live_mission_state, 
    get_replay_state, 
    get_mission_trajectory, 
    get_health,
    cache_service
)

router = APIRouter(prefix="/missions", tags=["Missions"])

# Mock Constants
ARTEMIS2_ID = "artemis-2"
ORION_VEHICLE_ID = "orion"

@router.get("/artemis2/state", response_model=MissionStateResponse)
async def get_artemis2_state(at: Optional[str] = Query(None)):
    """Returns the current or historical state of Artemis II."""
    if at:
        return get_replay_state(at)
    return await get_live_mission_state()

@router.get("/artemis2/trajectory", response_model=MissionTrajectoryResponse)
async def get_artemis2_trajectory(at: Optional[str] = Query(None)):
    """Returns past and planned trajectory points for Artemis II."""
    return get_mission_trajectory(at)

@router.get("/artemis2/events", response_model=MissionEventsResponse)
async def get_artemis2_events():
    """Returns the mission timeline and current phase status."""
    events = [
        MissionEvent(
            id="launch",
            name="Launch",
            description="SLS Launch from KSC",
            timestamp="2026-04-01T14:00:00Z",
            phase=MissionPhase.LAUNCH,
            isCompleted=True
        ),
        MissionEvent(
            id="tli",
            name="Trans-Lunar Injection",
            description="ICPS TLI Burn",
            timestamp="2026-04-01T16:30:00Z",
            phase=MissionPhase.EARTH_DEPARTURE,
            isCompleted=True
        ),
        MissionEvent(
            id="lunar-flyby",
            name="Lunar Flyby",
            description="Closest approach to Moon",
            timestamp="2026-04-05T08:00:00Z",
            phase=MissionPhase.LUNAR_FLYBY,
            isCompleted=False
        )
    ]
    
    return MissionEventsResponse(
        missionId=ARTEMIS2_ID,
        events=events,
        currentPhase=MissionPhase.TRANSLUNAR_COAST,
        nextEvent=events[2]
    )

@router.get("/artemis2/health", response_model=MissionHealthResponse)
async def get_artemis2_health():
    """Returns the health status of the mission data source."""
    return await get_health()
