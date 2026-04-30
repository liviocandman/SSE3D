from fastapi import APIRouter, Query
from typing import Optional

from app.models.mission_schemas import (
    MissionStateResponse, 
    MissionTrajectoryResponse, 
    MissionEventsResponse, 
    MissionHealthResponse,
)
from app.services.mission_data_service import (
    get_live_mission_state, 
    get_replay_state, 
    get_mission_events,
    get_health,
)
from app.services.mission_trajectory_builder import get_mission_trajectory

router = APIRouter(prefix="/missions", tags=["Missions"])

@router.get("/artemis2/state", response_model=MissionStateResponse)
async def get_artemis2_state(at: Optional[str] = Query(None)):
    """Returns the current or historical state of Artemis II."""
    if at:
        return await get_replay_state(at)
    return await get_live_mission_state()

@router.get("/artemis2/trajectory", response_model=MissionTrajectoryResponse)
async def get_artemis2_trajectory(at: Optional[str] = Query(None)):
    """Returns past and planned trajectory points for Artemis II."""
    return await get_mission_trajectory(at)

@router.get("/artemis2/events", response_model=MissionEventsResponse)
async def get_artemis2_events(at: Optional[str] = Query(None)):
    """Returns the mission timeline and current phase status."""
    return await get_mission_events(at)


@router.get("/artemis2/health", response_model=MissionHealthResponse)
async def get_artemis2_health():
    """Returns the health status of the mission data source."""
    return await get_health()
