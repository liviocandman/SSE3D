from fastapi import APIRouter, Query
from datetime import datetime, timezone
from typing import Optional
from app.models.mission_schemas import (
    MissionStateResponse, 
    MissionTrajectoryResponse, 
    MissionEventsResponse, 
    MissionHealthResponse,
    MissionPhase,
    MissionDataSource,
    MissionMode,
    MissionPosition,
    MissionVelocity,
    MissionDistances,
    MissionEvent,
    MissionTrajectoryPoint,
    MissionCoordinates,
    MissionTrajectorySegment,
)

router = APIRouter(prefix="/missions", tags=["Missions"])

# Mock Constants
ARTEMIS2_ID = "artemis-2"
ORION_VEHICLE_ID = "orion"

@router.get("/artemis2/state", response_model=MissionStateResponse)
async def get_artemis2_state(at: Optional[str] = Query(None)):
    """Returns the current or historical state of Artemis II."""
    mode = MissionMode.REPLAY if at else MissionMode.LIVE
    timestamp = at if at else datetime.now(timezone.utc).isoformat()
    
    return MissionStateResponse(
        missionId=ARTEMIS2_ID,
        vehicleId=ORION_VEHICLE_ID,
        mode=mode,
        phase=MissionPhase.TRANSLUNAR_COAST,
        source=MissionDataSource.AROW_LIVE if not at else MissionDataSource.ARCHIVE,
        sourceTimestamp=timestamp,
        stalenessSeconds=0.5,
        position=MissionPosition(x=150000.0, y=200000.0, z=50000.0),
        velocity=MissionVelocity(x=1.2, y=-0.5, z=0.1),
        distances=MissionDistances(earthKm=250000.0, moonKm=130000.0),
        missionElapsedTime="2-04:30:15",
        globalCoordinates=MissionCoordinates(x=150000.0, y=200000.0, z=50000.0),
        missionCoordinates=MissionCoordinates(x=150000.0, y=200000.0, z=50000.0)
    )

@router.get("/artemis2/trajectory", response_model=MissionTrajectoryResponse)
async def get_artemis2_trajectory():
    """Returns past and planned trajectory points for Artemis II."""
    return MissionTrajectoryResponse(
        missionId=ARTEMIS2_ID,
        past=[
            MissionTrajectoryPoint(
                timestamp="2026-04-03T12:00:00Z",
                position=MissionPosition(x=100000, y=150000, z=40000),
                velocity=MissionVelocity(x=1.1, y=-0.4, z=0.05),
                phase=MissionPhase.TRANSLUNAR_COAST,
                segment=MissionTrajectorySegment.PAST,
            )
        ],
        planned=[
            MissionTrajectoryPoint(
                timestamp="2026-04-05T12:00:00Z",
                position=MissionPosition(x=350000, y=50000, z=10000),
                velocity=MissionVelocity(x=0.5, y=-0.2, z=-0.1),
                phase=MissionPhase.LUNAR_FLYBY,
                segment=MissionTrajectorySegment.PLANNED,
            )
        ]
    )

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
    return MissionHealthResponse(
        missionId=ARTEMIS2_ID,
        currentSource=MissionDataSource.AROW_LIVE,
        lastUpdate=datetime.now(timezone.utc).isoformat(),
        dataAgeSeconds=0.5,
        fallbackActive=False,
        coverageStart="2026-04-01T14:00:00Z",
        coverageEnd="2026-04-11T11:00:00Z",
        details={"latency_ms": 120, "connected_clients": 42}
    )
