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
    get_spice_runtime_status,
    initialize_spice_kernels,
    shutdown_spice_kernels,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    spice_status = initialize_spice_kernels()

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

    yield

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
    return {"status": "ok"}
