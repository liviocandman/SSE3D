from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import httpx
from app.core.config import settings
from app.routers import ephemeris, astronomer

app = FastAPI(
    title="Solar Explorer 3D API",
    version="1.0.0",
    description="Backend Python para o Solar Explorer 3D",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

@app.exception_handler(httpx.TimeoutException)
async def timeout_handler(request: Request, exc: httpx.TimeoutException):
    return JSONResponse(
        status_code=504,
        content={
            "error": "UPSTREAM_TIMEOUT",
            "message": "O serviço externo não respondeu a tempo.",
        },
    )

@app.exception_handler(httpx.HTTPStatusError)
async def http_status_handler(request: Request, exc: httpx.HTTPStatusError):
    return JSONResponse(
        status_code=502,
        content={
            "error": "UPSTREAM_ERROR",
            "message": f"Serviço externo retornou erro {exc.response.status_code}.",
        },
    )

@app.exception_handler(httpx.RequestError)
async def request_error_handler(request: Request, exc: httpx.RequestError):
    return JSONResponse(
        status_code=502,
        content={
            "error": "NETWORK_ERROR",
            "message": "Não foi possível conectar ao serviço externo.",
        },
    )

app.include_router(ephemeris.router, prefix="/api")
app.include_router(astronomer.router, prefix="/api")

@app.get("/health")
async def health():
    return {"status": "ok"}
