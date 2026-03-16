from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from typing import Union
import json

class Settings(BaseSettings):
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    upstash_redis_rest_url: str = ""
    upstash_redis_rest_token: str = ""
    database_url: str = ""
    allowed_origins: Union[list[str], str] = ["http://localhost:3000"]
    rate_limit_requests: int = 5
    rate_limit_window_seconds: int = 3600
    nextauth_secret: str = ""
    bff_jwt_secret: str = ""

    @field_validator("database_url", mode="before")
    @classmethod
    def clean_database_url(cls, v: str) -> str:
        if "postgresql+asyncpg" in v and "sslmode=require" in v:
            return v.replace("?sslmode=require", "").replace("&sslmode=require", "")
        return v

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, list[str]]) -> list[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, str) and v.startswith("["):
            return json.loads(v)
        return v

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
