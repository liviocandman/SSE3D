from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

from app.core.config import settings
from app.core.database import init_db
from app.routers import ephemeris, astronomer, users
from app.services.asset_contract import read_json, validate_lock
from app.services.kernel_installation import effective_directory
from app.services.spice_kernel_manager import (
    get_spice_runtime_status,
    initialize_spice_kernels,
    shutdown_spice_kernels,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db_initialization_completed = False
    await init_db()
    app.state.db_initialization_completed = True
    kernel_directory = None
    kernel_lock = None
    if settings.spice_enabled:
        kernel_lock = validate_lock(read_json(settings.spice_lock_path), "kernels")
        kernel_directory = effective_directory(settings.spice_kernel_root, kernel_lock)
    spice_status = initialize_spice_kernels(kernel_directory, kernel_lock=kernel_lock)

    logger.info(
        "[Startup] API initiated. Database: {}",
        "configured" if settings.database_url else "not configured",
    )
    logger.info(
        "[Startup] Redis: {}",
        "configured" if settings.upstash_redis_rest_url else "not configured",
    )
    logger.info(
        "[Startup] SPICE enabled={} ready={} kernels={}",
        spice_status.enabled,
        spice_status.ready,
        len(spice_status.loaded_files),
    )
    try:
        yield
    finally:
        shutdown_spice_kernels()
    final_status = get_spice_runtime_status()
    logger.info("[Shutdown] SPICE cleanup completed. ready={}", final_status.ready)


app = FastAPI(
    title="Solar Explorer 3D API",
    version="1.0.0",
    description="Backend Python for Solar Explorer 3D",
    lifespan=lifespan,
)

# Compression Middleware
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(httpx.TimeoutException)
async def timeout_handler(request: Request, exc: httpx.TimeoutException):
    return JSONResponse(
        status_code=504,
        content={
            "error": "UPSTREAM_TIMEOUT",
            "message": "External service timed out.",
        },
    )


@app.exception_handler(httpx.HTTPStatusError)
async def http_status_handler(request: Request, exc: httpx.HTTPStatusError):
    return JSONResponse(
        status_code=502,
        content={
            "error": "UPSTREAM_ERROR",
            "message": f"External service returned status {exc.response.status_code}.",
        },
    )


@app.exception_handler(httpx.RequestError)
async def request_error_handler(request: Request, exc: httpx.RequestError):
    return JSONResponse(
        status_code=502,
        content={
            "error": "NETWORK_ERROR",
            "message": "Could not connect to external service.",
        },
    )


app.include_router(ephemeris.router, prefix="/api")
app.include_router(astronomer.router, prefix="/api")
app.include_router(users.router, prefix="/api")


@app.get("/health")
async def health():
    status = get_spice_runtime_status()
    return {
        "status": "ok" if status.ready or not status.enabled else "degraded",
        "serverReady": True,
        "dbConfigured": bool(settings.database_url),
        "dbInitializationCompleted": bool(getattr(app.state, "db_initialization_completed", False)),
        "spiceEnabled": status.enabled,
        "spiceReady": status.ready,
        "loadedKernelCount": len(status.loaded_files),
    }


@app.get("/ready")
async def ready():
    status = get_spice_runtime_status()
    accepted = (status.enabled and status.ready and status.kernels_present
                and status.coverage_validated and len(status.loaded_files) == 8
                and not status.missing_required_ids and not status.errors
                and bool(status.version and status.manifest_sha256)
                and status.validation_profile == "sse3d-spice-v1")
    reason = "ready" if accepted else ("spice_disabled" if not status.enabled else "spice_not_ready")
    return JSONResponse(status_code=200 if accepted else 503, content={
        "ready": bool(accepted), "reason": reason, "version": status.version,
        "manifestSha256": status.manifest_sha256, "archiveSha256": status.archive_sha256,
        "validationProfile": status.validation_profile, "validatorVersion": status.validator_version,
        "loadedKernelCount": len(status.loaded_files), "coverageValidated": status.coverage_validated,
        "missingRequiredIds": status.missing_required_ids, "errors": status.errors,
    })
