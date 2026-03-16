from pydantic import BaseModel, Field, field_validator, ConfigDict
from datetime import date, datetime
from typing import Optional

KNOWN_BODY_IDS = {"10", "199", "299", "399", "499", "599", "699", "799", "899"}

class Position(BaseModel):
    x: float
    y: float
    z: float

class EphemerisData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    
    body_id: str = Field(alias="bodyId")
    name: str
    position: Position
    velocity: Optional[Position] = None
    timestamp: str

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
