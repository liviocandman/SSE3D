from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from typing import Union
import json


class Settings(BaseSettings):
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    upstash_redis_rest_url: str = ""
    upstash_redis_rest_token: str = ""
    database_url: str = ""
    allowed_origins: Union[list[str], str] = ["http://localhost:3000"]
    rate_limit_requests: int = 5
    rate_limit_window_seconds: int = 3600
    nextauth_secret: str = ""
    bff_jwt_secret: str = ""

    # SPICE kernel configuration
    spice_enabled: bool = True
    spice_strict_kernels: bool = False
    spice_kernel_dir: str = "kernels"
    spice_lsk_file: str = "lsk/naif0012.tls"
    spice_planetary_spk_file: str = "spk/de440s.bsp"
    spice_moon_spk_files: Union[list[str], str] = ["spk/sse3d_moons_1849_2150.bsp"]

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

    @field_validator("spice_moon_spk_files", mode="before")
    @classmethod
    def assemble_moon_spk_files(cls, v: Union[str, list[str]]) -> list[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, str) and v.startswith("["):
            parsed = json.loads(v)
            return [str(i).strip() for i in parsed if str(i).strip()]
        return v

    @property
    def spice_kernel_root(self) -> Path:
        root = Path(self.spice_kernel_dir)
        if root.is_absolute():
            return root

        project_root = Path(__file__).resolve().parents[2]
        return (project_root / root).resolve()

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
