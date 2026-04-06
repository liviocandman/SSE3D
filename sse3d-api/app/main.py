import asyncio
import os
import sys
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

from app.core.config import settings
from app.core.database import init_db
from app.routers import ephemeris, astronomer, users, missions
from app.services.spice_kernel_manager import (
    get_missing_kernel_files,
    get_spice_runtime_status,
    initialize_spice_kernels,
    shutdown_spice_kernels,
)


async def _sync_kernels_in_background() -> None:
    if not settings.spice_enabled:
        return

    missing_files = get_missing_kernel_files()
    if not missing_files:
        logger.info("[SPICE Bootstrap] Kernel volume already warm. No background sync required.")
        return

    if not os.getenv("S3_KERNELS_URL"):
        logger.warning(
            "[SPICE Bootstrap] Missing S3_KERNELS_URL. Cannot hydrate missing kernels in background: {}",
            missing_files,
        )
        return

    logger.warning(
        "[SPICE Bootstrap] Missing {} kernel files at boot. Starting background sync.",
        len(missing_files),
    )

    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "scripts/fetch_kernels.py",
        "--kernel-root",
        str(settings.spice_kernel_root),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()

    if stdout:
        logger.info("[SPICE Bootstrap] {}", stdout.decode(errors="replace").strip())
    if stderr:
        logger.warning("[SPICE Bootstrap][stderr] {}", stderr.decode(errors="replace").strip())

    if process.returncode != 0:
        logger.error(
            "[SPICE Bootstrap] Background kernel sync failed with exit code {}.",
            process.returncode,
        )
        return

    spice_status = initialize_spice_kernels(validate_coverage=True)
    logger.info(
        "[SPICE Bootstrap] Background sync complete. ready={} kernels={}",
        spice_status.ready,
        len(spice_status.loaded_files),
    )


async def _validate_spice_coverage_in_background() -> None:
    if not settings.spice_enabled:
        return

    spice_status = get_spice_runtime_status()
    if not spice_status.ready or spice_status.coverage_validated:
        return

    logger.info("[SPICE Bootstrap] Starting background coverage validation for warm kernel volume.")
    validated_status = initialize_spice_kernels(validate_coverage=True)
    logger.info(
        "[SPICE Bootstrap] Background coverage validation finished. ready={} coverageValidated={} missing={}",
        validated_status.ready,
        validated_status.coverage_validated,
        len(validated_status.missing_required_ids),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db_ready = False
    await init_db()
    app.state.db_ready = True
    spice_status = initialize_spice_kernels(validate_coverage=False)
    app.state.kernel_sync_task = None
    app.state.spice_validation_task = None

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
    if not spice_status.ready and settings.spice_enabled:
        app.state.kernel_sync_task = asyncio.create_task(_sync_kernels_in_background())
    elif spice_status.ready and settings.spice_enabled and not spice_status.coverage_validated:
        app.state.spice_validation_task = asyncio.create_task(_validate_spice_coverage_in_background())

    yield

    kernel_sync_task = getattr(app.state, "kernel_sync_task", None)
    if kernel_sync_task and not kernel_sync_task.done():
        kernel_sync_task.cancel()
    spice_validation_task = getattr(app.state, "spice_validation_task", None)
    if spice_validation_task and not spice_validation_task.done():
        spice_validation_task.cancel()

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
app.include_router(missions.router, prefix="/api")


@app.get("/health")
async def health():
    spice_status = get_spice_runtime_status()
    db_ready = bool(getattr(app.state, "db_ready", False))
    kernel_sync_task = getattr(app.state, "kernel_sync_task", None)
    kernel_sync_in_progress = bool(kernel_sync_task and not kernel_sync_task.done())
    kernels_present = spice_status.kernels_present

    if not db_ready or (spice_status.enabled and kernel_sync_in_progress and not kernels_present):
        status = "booting"
    elif spice_status.enabled and not spice_status.ready:
        status = "degraded"
    else:
        status = "ok"

    return {
        "status": status,
        "serverReady": True,
        "dbReady": db_ready,
        "spiceEnabled": spice_status.enabled,
        "spiceReady": spice_status.ready,
        "kernelsPresent": kernels_present,
        "coverageValidated": spice_status.coverage_validated,
        "kernelSyncInProgress": kernel_sync_in_progress,
        "loadedKernelCount": len(spice_status.loaded_files),
        "spiceErrors": spice_status.errors,
    }
