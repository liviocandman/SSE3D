from pydantic import BaseModel, Field, field_validator, ConfigDict
from datetime import date, datetime
from typing import Optional, List
from enum import Enum

KNOWN_BODY_IDS = {
    "10",
    "199",
    "299",
    "399",
    "499",
    "599",
    "699",
    "799",
    "899",
    "999",  # Pluto
    # Moons
    "301",
    "401", "402",  # Mars moons
    "501", "502", "503", "504",
    "601", "602", "603", "604", "605", "606", "608",  # Saturn moons
    "701", "702", "703", "704", "705",  # Uranus moons
    "801",  # Neptune moon
    "901",  # Pluto moon
}

class OrbitLineProfile(str, Enum):
    RAPID = "rapid"
    REGULAR = "regular"
    AUTO = "auto"

class Position(BaseModel):
    x: float
    y: float
    z: float

class OrbitLinePoint(BaseModel):
    x: float
    y: float
    z: float
    timestamp: str

class OrbitLineData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    
    points: List[OrbitLinePoint]
    is_closed: bool = Field(alias="isClosed")
    profile: OrbitLineProfile
    algorithm_version: str = Field(alias="algorithmVersion")
    source_window_start: str = Field(alias="sourceWindowStart")
    source_window_end: str = Field(alias="sourceWindowEnd")
    input_point_count: int = Field(alias="inputPointCount")
    output_point_count: int = Field(alias="outputPointCount")
    quality_flags: List[str] = Field(default_factory=list, alias="qualityFlags")

class EphemerisTrajectory(BaseModel):
    position: Position
    velocity: Optional[Position] = None
    timestamp: str

class EphemerisData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    
    body_id: str = Field(alias="bodyId")
    name: str
    position: Position
    velocity: Optional[Position] = None
    timestamp: str
    parent_id: Optional[str] = Field(default=None, alias="parentId")
    trajectory: Optional[List[EphemerisTrajectory]] = None
    orbit_line: Optional[OrbitLineData] = Field(default=None, alias="orbitLine")

class EphemerisMeta(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    
    source: str
    timestamp: str
    requested_date: str = Field(alias="requestedDate")
    cache_hits: Optional[int] = Field(default=None, alias="cacheHits")
    cache_misses: Optional[int] = Field(default=None, alias="cacheMisses")

class EphemerisResponse(BaseModel):
    data: list[EphemerisData]
    meta: EphemerisMeta

class AstronomerRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    
    body_id: str = Field(alias="bodyId")
    date: date
    question: str = Field(min_length=3, max_length=500)
    session_id: Optional[str] = Field(default=None, alias="sessionId", max_length=64)
    body_type: Optional[str] = Field(default=None, alias="bodyType")
    parent_name: Optional[str] = Field(default=None, alias="parentName")

    @field_validator("body_id")
    @classmethod
    def validate_body_id(cls, v: str) -> str:
        if v not in KNOWN_BODY_IDS:
            raise ValueError(f"Unknown body ID: {v}. Valid IDs: {KNOWN_BODY_IDS}")
        return v

    @field_validator("question")
    @classmethod
    def sanitize_question(cls, v: str) -> str:
        return " ".join(v.split()).strip()

class AstronomerResponse(BaseModel):
    answer: str

class SaveFavoriteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    
    body_id: str = Field(alias="bodyId", max_length=10)
    body_name: str = Field(alias="bodyName", max_length=50)
    question: str = Field(max_length=500)
    answer: str
    session_id: Optional[str] = Field(default=None, alias="sessionId", max_length=64)

class FavoriteResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)
    
    id: int
    body_id: str = Field(alias="bodyId")
    body_name: str = Field(alias="bodyName")
    question: str
    answer: str
    created_at: datetime
