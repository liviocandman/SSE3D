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

    # AROW Live Mission configuration
    arow_live_enabled: bool = True
    arow_live_url: str = "https://www.nasa.gov/specials/trackartemis/data/trackartemis_locations.json"
    arow_timeout_seconds: float = 5.0
    arow_cache_ttl_seconds: int = 20
    arow_stale_warning_seconds: int = 300
    arow_stale_fallback_seconds: int = 600
    arow_user_agent: str = "SolarExplore3D/1.0"
    arow_retry_count: int = 1
    arow_input_frame: str = "J2000"
    arow_position_origin: str = "EARTH"
    mission_oem_enabled: bool = True
    mission_oem_path: str = r"C:\Users\Reuther\Downloads\artemis-ii-oem-2026-04-03-to-ei\Artemis_II_OEM_2026_04_03_to_EI.asc"

    # SPICE kernel configuration
    spice_enabled: bool = True
    spice_strict_kernels: bool = False
    spice_kernel_dir: str = "kernels"
    spice_lsk_file: str = "lsk/naif0012.tls"
    spice_planetary_spk_file: str = "spk/de440.bsp"
    spice_moon_spk_files: Union[list[str], str] = [
        "spk/mar099_min.bsp",
        "spk/jup365_min.bsp",
        "spk/sat441_min.bsp",
        "spk/ura111_min.bsp",
        "spk/nep081_min.bsp",
        "spk/plu060_min.bsp",
    ]

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
