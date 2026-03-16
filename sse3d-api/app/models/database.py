from sqlmodel import SQLModel, Field, Relationship, UniqueConstraint
from datetime import datetime
from typing import Optional, List

class User(SQLModel, table=True):
    """
    Unified User profile. Linked to one or more Accounts.
    ID is an internal UUID string.
    """
    id: str = Field(primary_key=True)
    email: str = Field(unique=True, index=True)
    name: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    accounts: List["Account"] = Relationship(back_populates="user")
    favorites: List["FavoriteQuestion"] = Relationship(back_populates="user")

class Account(SQLModel, table=True):
    """
    OAuth accounts linked to a User profile.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    provider: str = Field(index=True)
    provider_account_id: str = Field(index=True)
    user_id: str = Field(foreign_key="user.id", index=True)

    # Relationships
    user: User = Relationship(back_populates="accounts")

    __table_args__ = (
        UniqueConstraint("provider", "provider_account_id"),
    )

class FavoriteQuestion(SQLModel, table=True):
    """
    Hybrid table supporting anonymous (session_id) and authenticated (user_id) favorites.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    
    # Ownership
    session_id: Optional[str] = Field(default=None, index=True, max_length=64)
    user_id: Optional[str] = Field(
        default=None, 
        foreign_key="user.id", 
        index=True
    )
    
    body_id: str = Field(max_length=10)
    body_name: str = Field(max_length=50)
    question: str = Field(max_length=500)
    answer: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationship
    user: Optional[User] = Relationship(back_populates="favorites")
