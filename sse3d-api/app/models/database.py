from sqlmodel import SQLModel, Field
from datetime import datetime
from typing import Optional

class FavoriteQuestion(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: str = Field(index=True, max_length=64)
    body_id: str = Field(max_length=10)
    body_name: str = Field(max_length=50)
    question: str = Field(max_length=500)
    answer: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
