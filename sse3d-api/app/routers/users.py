from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select, delete
from loguru import logger
from typing import Optional
from app.core.auth import require_authenticated_user
from app.core.database import get_session
from app.models.database import User, FavoriteQuestion

router = APIRouter(prefix="/users", tags=["Users"])

class MergeAnonymousRequest(BaseModel):
    session_id: str

@router.post("/merge-anonymous")
async def merge_anonymous(
    payload: MergeAnonymousRequest,
    current_user: User = Depends(require_authenticated_user),
    session: Optional[AsyncSession] = Depends(get_session),
):
    """
    Migrates all anonymous favorites from a session to the logged-in user.
    Handles duplicates by checking if the user already has the favorite.
    """
    if session is None:
        return JSONResponse(
            status_code=503,
            content={"error": "DATABASE_UNAVAILABLE"},
        )

    if not payload.session_id or len(payload.session_id) > 64:
        raise HTTPException(status_code=400, detail="Invalid session_id.")

    # 1. Fetch anonymous favorites
    anon_result = await session.execute(
        select(FavoriteQuestion)
        .where(FavoriteQuestion.session_id == payload.session_id)
        .where(FavoriteQuestion.user_id == None)
    )
    anon_favs = anon_result.scalars().all()

    if not anon_favs:
        return {"migrated": 0, "message": "Nenhum favorito para migrar."}

    # 2. Fetch existing user favorites to check for duplicates
    user_result = await session.execute(
        select(FavoriteQuestion)
        .where(FavoriteQuestion.user_id == current_user.id)
    )
    user_favs = user_result.scalars().all()
    # Create a lookup set for existing favorites (body_id + question)
    existing_lookup = {(f.body_id, f.question) for f in user_favs}

    migrated_count = 0
    to_delete = []

    for anon_fav in anon_favs:
        key = (anon_fav.body_id, anon_fav.question)
        if key not in existing_lookup:
            # Not a duplicate: migrate it
            anon_fav.user_id = current_user.id
            anon_fav.session_id = None
            migrated_count += 1
            existing_lookup.add(key)
        else:
            # Duplicate: mark for deletion
            to_delete.append(anon_fav.id)

    # 3. Clean up duplicates
    if to_delete:
        await session.execute(
            delete(FavoriteQuestion).where(FavoriteQuestion.id.in_(to_delete))
        )

    await session.commit()
    logger.info(f"User {current_user.id}: {migrated_count} favorite(s) migrated, {len(to_delete)} duplicates removed.")

    return {
        "migrated": migrated_count,
        "user_id": current_user.id,
        "message": f"{migrated_count} favorito(s) migrado(s) com sucesso.",
    }

