from pydantic import BaseModel, Field, field_validator, ConfigDict
from datetime import date
from typing import Optional

# IDs válidos
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
