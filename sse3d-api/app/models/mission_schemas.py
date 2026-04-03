from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict

class MissionDataSource(str, Enum):
    AROW_LIVE = "AROW_LIVE"
    ARCHIVE = "ARCHIVE"
    SPICE_PREDICTED = "SPICE_PREDICTED"

class MissionMode(str, Enum):
    LIVE = "live"
    REPLAY = "replay"
    PREDICTED = "predicted"

class MissionPhase(str, Enum):
    LAUNCH = "launch"
    EARTH_DEPARTURE = "earth_departure"
    TRANSLUNAR_COAST = "translunar_coast"
    LUNAR_FLYBY = "lunar_flyby"
    RETURN_COAST = "return_coast"
    REENTRY = "reentry"
    SPLASHDOWN = "splashdown"

class MissionTrajectorySegment(str, Enum):
    PAST = "past"
    CURRENT = "current"
    PLANNED = "planned"

class MissionPosition(BaseModel):
    x: float
    y: float
    z: float

class MissionVelocity(BaseModel):
    x: float
    y: float
    z: float

class MissionCoordinates(BaseModel):
    x: float
    y: float
    z: float

class MissionDistances(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    earth_km: float = Field(alias="earthKm")
    moon_km: float = Field(alias="moonKm")

class MissionEvent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    name: str
    description: str
    timestamp: str
    phase: MissionPhase
    is_completed: bool = Field(alias="isCompleted")

class MissionTrajectoryPoint(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    timestamp: str
    position: MissionPosition
    velocity: Optional[MissionVelocity] = None
    phase: Optional[MissionPhase] = None
    segment: MissionTrajectorySegment

class MissionStateResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    
    mission_id: str = Field(alias="missionId")
    vehicle_id: str = Field(alias="vehicleId")
    mode: MissionMode
    phase: MissionPhase
    source: MissionDataSource
    source_timestamp: str = Field(alias="sourceTimestamp")
    staleness_seconds: float = Field(alias="stalenessSeconds")
    
    position: MissionPosition
    velocity: MissionVelocity
    distances: MissionDistances
    
    mission_elapsed_time: str = Field(alias="missionElapsedTime")
    global_coordinates: Optional[MissionCoordinates] = Field(default=None, alias="globalCoordinates")
    mission_coordinates: Optional[MissionCoordinates] = Field(default=None, alias="missionCoordinates")

class MissionTrajectoryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    mission_id: str = Field(alias="missionId")
    past: List[MissionTrajectoryPoint]
    planned: List[MissionTrajectoryPoint]

class MissionEventsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    mission_id: str = Field(alias="missionId")
    events: List[MissionEvent]
    current_phase: MissionPhase = Field(alias="currentPhase")
    next_event: Optional[MissionEvent] = Field(default=None, alias="nextEvent")

class MissionHealthResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    mission_id: str = Field(alias="missionId")
    status: str = "unknown"
    source: MissionDataSource = MissionDataSource.AROW_LIVE
    last_update: str = Field(alias="lastUpdate")
    
    current_source: MissionDataSource = Field(alias="currentSource")
    data_age_seconds: float = Field(alias="dataAgeSeconds")
    fallback_active: bool = Field(alias="fallbackActive")
    coverage_start: Optional[str] = Field(default=None, alias="coverageStart")
    coverage_end: Optional[str] = Field(default=None, alias="coverageEnd")
    
    details: Optional[dict] = None
