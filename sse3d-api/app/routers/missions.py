from fastapi import APIRouter, Query, HTTPException
from datetime import datetime, timezone
from typing import Optional
from loguru import logger

from app.models.mission_schemas import (
    MissionStateResponse, 
    MissionTrajectoryResponse, 
    MissionEventsResponse, 
    MissionHealthResponse,
    MissionMode,
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
from app.services.mission_arow_client import AROWClient
from app.services.mission_normalizer import normalize_arow_live_payload, create_mission_health
from app.services.mission_cache_service import MissionCacheService

router = APIRouter(prefix="/missions", tags=["Missions"])

# Shared service instances
arow_client = AROWClient()
cache_service = MissionCacheService()

# Mock Constants
ARTEMIS2_ID = "artemis-2"
ORION_VEHICLE_ID = "orion"

@router.get("/artemis2/state", response_model=MissionStateResponse)
async def get_artemis2_state(at: Optional[str] = Query(None)):
    """Returns the current or historical state of Artemis II."""
    
    # 1. Historical / Replay Mode (Isolated from AROW)
    if at:
        timestamp = at
        return MissionStateResponse(
            missionId=ARTEMIS2_ID,
            vehicleId=ORION_VEHICLE_ID,
            mode=MissionMode.REPLAY,
            phase=MissionPhase.TRANSLUNAR_COAST,
            source=MissionDataSource.ARCHIVE,
            sourceTimestamp=timestamp,
            stalenessSeconds=0.0,
            position=MissionPosition(x=150000.0, y=200000.0, z=50000.0),
            velocity=MissionVelocity(x=1.2, y=-0.5, z=0.1),
            distances=MissionDistances(earthKm=250000.0, moonKm=130000.0),
            missionElapsedTime="2-04:30:15",
            globalCoordinates=MissionCoordinates(x=150000.0, y=200000.0, z=50000.0),
            missionCoordinates=MissionCoordinates(x=150000.0, y=200000.0, z=50000.0)
        )

    # 2. Live Mode with Cache and AROW Integration
    try:
        # Check Cache first
        state, _ = await cache_service.get_live_state()
        if state:
            return state
            
        # Cache Miss: Fetch from AROW
        logger.info("Mission cache miss: fetching from AROW")
        arow_data = await arow_client.fetch_live_data()
        
        # Normalize
        live_state = normalize_arow_live_payload(
            arow_data["raw_payload"],
            arow_data["headers"],
            arow_data["fetched_at"]
        )
        
        # Create Health and Cache both
        live_health = create_mission_health(
            live_state, arow_data["headers"], arow_data["fetched_at"], raw_payload=arow_data["raw_payload"]
        )
        await cache_service.set_live_state(live_state, live_health)
        
        return live_state

    except Exception as e:
        logger.warning(f"AROW fetch failed: {str(e)}. Attempting fallback to last good state.")
        
        # Fallback to Last Known Good State
        fallback_state, _ = await cache_service.get_last_good_state()
        if fallback_state:
            return fallback_state
            
        # Ultimate Fallback: Predicted data
        logger.error("No last good state found. Returning predicted data as ultimate fallback.")
        return MissionStateResponse(
            missionId=ARTEMIS2_ID,
            vehicleId=ORION_VEHICLE_ID,
            mode=MissionMode.PREDICTED,
            phase=MissionPhase.TRANSLUNAR_COAST,
            source=MissionDataSource.SPICE_PREDICTED,
            sourceTimestamp=datetime.now(timezone.utc).isoformat(),
            stalenessSeconds=999.9,
            position=MissionPosition(x=150000.0, y=200000.0, z=50000.0),
            velocity=MissionVelocity(x=1.2, y=-0.5, z=0.1),
            distances=MissionDistances(earthKm=250000.0, moonKm=130000.0),
            missionElapsedTime="0-00:00:00",
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
                segment=MissionTrajectorySegment.PAST # Corrected: Enum value
            )
        ],
        planned=[
            MissionTrajectoryPoint(
                timestamp="2026-04-05T12:00:00Z",
                position=MissionPosition(x=350000, y=50000, z=10000),
                velocity=MissionVelocity(x=0.5, y=-0.2, z=-0.1),
                phase=MissionPhase.LUNAR_FLYBY,
                segment=MissionTrajectorySegment.PLANNED # Corrected: Enum value
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
    # Check Cache first
    _, health = await cache_service.get_live_state()
    if health:
        return health
        
    # If not in live cache, check last good
    _, last_good_health = await cache_service.get_last_good_state()
    if last_good_health:
        # Mark as fallback/degraded
        last_good_health.status = "degraded"
        last_good_health.fallback_active = True # Corrected: Set model field
        last_good_health.current_source = last_good_health.source
        if last_good_health.details:
            last_good_health.details["fallbackActive"] = True
        return last_good_health

    # Default Mock Health
    now = datetime.now(timezone.utc).isoformat()
    return MissionHealthResponse(
        missionId=ARTEMIS2_ID,
        status="nominal",
        source=MissionDataSource.AROW_LIVE,
        lastUpdate=now,
        currentSource=MissionDataSource.AROW_LIVE,
        dataAgeSeconds=0.0,
        fallbackActive=False,
        coverageStart=None,
        coverageEnd=None,
        details={"status": "initializing", "info": "No cached data available"}
    )
