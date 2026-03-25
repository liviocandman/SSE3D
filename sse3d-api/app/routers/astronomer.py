from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse
from loguru import logger
from app.models.schemas import (
    AstronomerRequest,
    AstronomerResponse,
    SaveFavoriteRequest,
    FavoriteResponse,
)
from app.services.ai_service import ask_astronomer
from app.core.ratelimit import check_rate_limit
from app.core.auth import get_optional_user
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select, func
from app.core.database import get_session
from app.models.database import FavoriteQuestion, User
from typing import List, Optional

router = APIRouter(prefix="/ai", tags=["Astronomer"])

def _get_rate_limit_identifier(request: Request, user: Optional[User], session_id: Optional[str]) -> str:
    """
    Priority: User ID (if authenticated) > Session ID > Client IP.
    This rewards logged-in users and handles NAT scenarios better.
    """
    if user:
        return f"user:{user.id}"
        
    if session_id:
        return f"session:{session_id}"
    
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
        return f"ip:{ip}" if ip else "ip:fallback"
    
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return f"ip:{real_ip.strip()}"

    return f"ip:{request.client.host}" if request.client else "ip:fallback"

@router.post("", response_model=AstronomerResponse)
async def post_ask_astronomer(
    payload: AstronomerRequest, 
    request: Request,
    user: Optional[User] = Depends(get_optional_user)
):
    identifier = _get_rate_limit_identifier(request, user, payload.session_id)
    rate = await check_rate_limit(identifier)

    if not rate["allowed"]:
        logger.warning(f"Rate limit exceeded for {identifier}")
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
        body_type=payload.body_type,
        parent_name=payload.parent_name,
    )

    return AstronomerResponse(answer=answer)


@router.post("/favorites", status_code=201)
async def save_favorite(
    payload: SaveFavoriteRequest,
    user: Optional[User] = Depends(get_optional_user),
    session: Optional[AsyncSession] = Depends(get_session),
):
    if session is None:
        return JSONResponse(
            status_code=503,
            content={"error": "DATABASE_UNAVAILABLE"}
        )

    if user:
        # Authenticated: no limit
        fav = FavoriteQuestion(
            user_id=user.id,
            session_id=None,
            body_id=payload.body_id,
            body_name=payload.body_name,
            question=payload.question,
            answer=payload.answer,
        )
        session.add(fav)
        await session.commit()
        await session.refresh(fav)
        return {"id": fav.id}

    # Anonymous: verify limit (2 per body_id per session_id)
    if not payload.session_id:
        return JSONResponse(
            status_code=400,
            content={"error": "SESSION_REQUIRED", "message": "session_id is required for anonymous favorites."}
        )

    count_result = await session.execute(
        select(func.count(FavoriteQuestion.id))
        .where(FavoriteQuestion.session_id == payload.session_id)
        .where(FavoriteQuestion.body_id == payload.body_id)
    )
    count = count_result.scalar_one()

    if count >= 2:
        return JSONResponse(
            status_code=403,
            content={
                "error": "LIMIT_REACHED",
                "message": "Limite de 2 favoritos por planeta atingido. Faça login para salvar mais.",
                "current_count": count,
                "limit": 2,
            },
        )

    fav = FavoriteQuestion(
        session_id=payload.session_id,
        user_id=None,
        body_id=payload.body_id,
        body_name=payload.body_name,
        question=payload.question,
        answer=payload.answer,
    )
    session.add(fav)
    await session.commit()
    await session.refresh(fav)
    return {"id": fav.id}

@router.get("/favorites", response_model=List[FavoriteResponse])
async def get_favorites(
    request: Request,
    session_id: Optional[str] = None,
    body_id: Optional[str] = None,
    user: Optional[User] = Depends(get_optional_user),
    session: Optional[AsyncSession] = Depends(get_session),
):
    if session is None:
        return []

    # Backward compatibility for camelCase query params.
    if not session_id:
        session_id = request.query_params.get("sessionId")
    if not body_id:
        body_id = request.query_params.get("bodyId")

    query = select(FavoriteQuestion).order_by(FavoriteQuestion.created_at.desc()).limit(50)

    if user:
        query = query.where(FavoriteQuestion.user_id == user.id)
    elif session_id:
        query = query.where(FavoriteQuestion.session_id == session_id)
    else:
        return []

    if body_id:
        query = query.where(FavoriteQuestion.body_id == body_id)

    result = await session.execute(query)
    return result.scalars().all()

@router.delete("/favorites/{favorite_id}", status_code=204)
async def delete_favorite(
    request: Request,
    favorite_id: int,
    user: Optional[User] = Depends(get_optional_user),
    session: Optional[AsyncSession] = Depends(get_session),
):
    if session is None:
        return JSONResponse(status_code=503, content={"error": "DATABASE_UNAVAILABLE"})

    result = await session.execute(
        select(FavoriteQuestion).where(FavoriteQuestion.id == favorite_id)
    )
    fav = result.scalar_one_or_none()

    if not fav:
        return JSONResponse(status_code=404, content={"error": "NOT_FOUND"})

    if user:
        if fav.user_id != user.id:
            return JSONResponse(status_code=403, content={"error": "UNAUTHORIZED"})
    else:
        if fav.user_id:
            return JSONResponse(status_code=401, content={"error": "LOGIN_REQUIRED"})

        session_id = request.query_params.get("session_id") or request.query_params.get("sessionId")
        if not session_id:
            return JSONResponse(status_code=401, content={"error": "SESSION_REQUIRED"})
        if fav.session_id != session_id:
            return JSONResponse(status_code=403, content={"error": "UNAUTHORIZED"})

    await session.delete(fav)
    await session.commit()
    return None
