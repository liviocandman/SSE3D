from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse
from app.models.schemas import AstronomerRequest, AstronomerResponse
from app.services.ai_service import ask_astronomer, PLANET_LABELS
from app.core.ratelimit import check_rate_limit
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from app.core.database import get_session
from app.models.database import FavoriteQuestion

router = APIRouter(prefix="/ai", tags=["Astronomer"])

def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
        return ip if ip else "fallback-no-ip"
    
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()

    return request.client.host if request.client else "fallback-no-ip"

@router.post("", response_model=AstronomerResponse)
async def post_ask_astronomer(payload: AstronomerRequest, request: Request):
    ip = _get_client_ip(request)
    rate = await check_rate_limit(ip)

    if not rate["allowed"]:
        return JSONResponse(
            status_code=429,
            content={
                "error": "RATE_LIMITED",
                "message": "Limite de perguntas atingido. Aguarde antes de continuar.",
                "retryAfterSeconds": rate["reset_seconds"],
            },
        )

    answer = await ask_astronomer(
        body_id=payload.body_id,
        target_date=str(payload.date),
        question=payload.question,
    )

    return AstronomerResponse(answer=answer)

@router.post("/favorites", status_code=201)
async def save_favorite(
    body_id: str,
    question: str,
    answer: str,
    session_id: str,
    session: AsyncSession = Depends(get_session),
):
    if session is None:
        return JSONResponse(
            status_code=503,
            content={"error": "DATABASE_UNAVAILABLE", "message": "Banco de dados não configurado."}
        )
        
    fav = FavoriteQuestion(
        session_id=session_id,
        body_id=body_id,
        body_name=PLANET_LABELS.get(body_id, ("Unknown",))[0],
        question=question,
        answer=answer,
    )
    session.add(fav)
    await session.commit()
    return {"id": fav.id}

@router.get("/favorites/{session_id}")
async def get_favorites(
    session_id: str,
    session: AsyncSession = Depends(get_session),
):
    if session is None:
        return []
        
    result = await session.execute(
        select(FavoriteQuestion)
        .where(FavoriteQuestion.session_id == session_id)
        .order_by(FavoriteQuestion.created_at.desc())
        .limit(20)
    )
    return result.scalars().all()
