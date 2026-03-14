from sqlmodel import SQLModel
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

from typing import AsyncGenerator, Optional

engine = None
AsyncSessionLocal = None

if settings.database_url:
    engine = create_async_engine(settings.database_url, echo=False)
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def init_db():
    if not engine:
        print("[DB] DATABASE_URL not configured — skipping init")
        return
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

async def get_session() -> AsyncGenerator[Optional[AsyncSession], None]:
    if not AsyncSessionLocal:
        yield None
        return
    async with AsyncSessionLocal() as session:
        yield session
