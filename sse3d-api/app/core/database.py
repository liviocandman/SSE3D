from sqlmodel import SQLModel
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

from typing import AsyncGenerator, Optional

engine = None
AsyncSessionLocal = None

if settings.database_url:
    
    db_url = settings.database_url
    connect_args = {}
    
    # asyncpg uses 'ssl' instead of 'sslmode'
    if "sslmode=disable" in db_url:
        db_url = db_url.replace("?sslmode=disable", "").replace("&sslmode=disable", "")
        connect_args["ssl"] = False
    elif "sslmode=require" in db_url:
        db_url = db_url.replace("?sslmode=require", "").replace("&sslmode=require", "")
        connect_args["ssl"] = "require"
        
    engine = create_async_engine(db_url, echo=False, connect_args=connect_args)
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
