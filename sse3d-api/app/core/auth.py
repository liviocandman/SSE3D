import jwt
import uuid
from loguru import logger
from fastapi import Request, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from typing import Optional
from app.core.config import settings
from app.core.database import get_session
from app.models.database import User, Account

def _extract_bearer_token(request: Request) -> Optional[str]:
    """Extracts token from Authorization: Bearer <token> header."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    token = auth_header[len("Bearer "):]
    return token if token else None

def _decode_bff_jwt(token: str) -> dict:
    """Decodes server-to-server JWT using BFF_JWT_SECRET."""
    if not settings.bff_jwt_secret:
        raise ValueError("BFF_JWT_SECRET not configured in backend")

    payload = jwt.decode(
        token,
        settings.bff_jwt_secret,
        algorithms=["HS256"],
        options={"verify_aud": True},
        audience="sse3d-api",
        issuer="sse3d-bff",
    )
    return payload

async def get_optional_user(
    request: Request,
    session: Optional[AsyncSession] = Depends(get_session),
) -> Optional[User]:
    """
    FastAPI dependency: returns authenticated User or None.
    Implements Identity Linking:
    1. Find by Account (provider + provider_account_id)
    2. Else find by Email -> Link to existing User
    3. Else create new User + Account
    """
    token = _extract_bearer_token(request)
    if not token or not session:
        return None

    try:
        payload = _decode_bff_jwt(token)
    except jwt.InvalidTokenError as e:
        logger.warning(f"[Auth] Invalid BFF JWT: {e}")
        raise HTTPException(
            status_code=401,
            detail={"error": "INVALID_TOKEN", "message": str(e)}
        )

    provider = payload.get("provider")

    provider_account_id = payload.get("provider_account_id")
    email = payload.get("email")
    name = payload.get("name", "")

    if not provider or not provider_account_id:
        logger.warning(f"[Auth] Missing identity info in token: {payload}")
        return None

    # 1. Find by Account
    stmt = select(Account).where(
        Account.provider == provider,
        Account.provider_account_id == provider_account_id
    )
    result = await session.execute(stmt)
    account = result.scalar_one_or_none()

    if account:
        # User already has this account linked
        res = await session.execute(select(User).where(User.id == account.user_id))
        return res.scalar_one_or_none()

    # 2. Find by Email (Identity Linking)
    user = None
    if email:
        stmt = select(User).where(User.email == email)
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()

    if not user:
        # 3. Create new User
        internal_email = email or f"{provider}_{provider_account_id}@no-email.local"
        user = User(
            id=str(uuid.uuid4()),
            email=internal_email,
            name=name
        )
        session.add(user)
        # Flush to get user.id for account
        await session.flush()
        logger.info(f"[Auth] New unified user created: {user.id} ({internal_email})")

    # Link current account to the user
    new_account = Account(
        provider=provider,
        provider_account_id=provider_account_id,
        user_id=user.id
    )
    session.add(new_account)
    await session.commit()
    await session.refresh(user)
    logger.info(f"[Auth] Linked {provider} account to user {user.id}")

    return user

async def require_authenticated_user(
    user: Optional[User] = Depends(get_optional_user),
) -> User:
    
    if user is None:
        raise HTTPException(
            status_code=401,
            detail={"error": "UNAUTHORIZED", "message": "Autenticação necessária."},
        )
    return user
