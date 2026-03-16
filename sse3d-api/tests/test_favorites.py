import pytest
from httpx import AsyncClient
from unittest.mock import patch, MagicMock
from app.main import app
from app.models.database import FavoriteQuestion, User
from app.core.database import get_session
import jwt
from uuid import uuid4

# Mock NextAuth Secret
MOCK_SECRET = "test-secret"

@pytest.fixture
def mock_token():
    return jwt.encode({"sub": "user_123", "email": "test@example.com", "name": "Test User"}, MOCK_SECRET, algorithm="HS256")

@pytest.mark.asyncio
async def test_save_favorite_anonymous_allowed(client):
    """Verify anonymous can save up to 2 favorites per planet."""
    session_id = f"session-{uuid4()}"
    # 1st save
    resp = await client.post("/api/ai/favorites", json={
        "bodyId": "499",
        "bodyName": "Mars",
        "question": "Pergunta 1",
        "answer": "Resposta 1",
        "sessionId": session_id
    })
    assert resp.status_code == 201

    # 2nd save
    resp = await client.post("/api/ai/favorites", json={
        "bodyId": "499",
        "bodyName": "Mars",
        "question": "Pergunta 2",
        "answer": "Resposta 2",
        "sessionId": session_id
    })
    assert resp.status_code == 201

@pytest.mark.asyncio
async def test_save_favorite_anonymous_limit_reached(client):
    """Verify anonymous is blocked after 2 favorites on the same planet."""
    session_id = f"session-{uuid4()}"
    # 1st save
    await client.post("/api/ai/favorites", json={
        "bodyId": "499",
        "bodyName": "Mars",
        "question": "Pergunta 1",
        "answer": "Resposta 1",
        "sessionId": session_id
    })

    # 2nd save
    await client.post("/api/ai/favorites", json={
        "bodyId": "499",
        "bodyName": "Mars",
        "question": "Pergunta 2",
        "answer": "Resposta 2",
        "sessionId": session_id
    })

    # 3rd save should fail
    resp = await client.post("/api/ai/favorites", json={
        "bodyId": "499",
        "bodyName": "Mars",
        "question": "Pergunta 3",
        "answer": "Resposta 3",
        "sessionId": session_id
    })
    assert resp.status_code == 403
    assert resp.json()["error"] == "LIMIT_REACHED"

@pytest.mark.asyncio
async def test_save_favorite_authenticated_no_limit(client, mock_token):
    """Verify authenticated users have no favorites limits."""
    # We patch the secret to match our mock token
    with patch("app.core.config.settings.nextauth_secret", MOCK_SECRET):
        # Should be able to save more than 2
        for i in range(3):
            resp = await client.post("/api/ai/favorites", json={
                "bodyId": "499",
                "bodyName": "Mars",
                "question": f"Pergunta {i+4}",
                "answer": f"Resposta {i+4}",
            }, headers={"Authorization": f"Bearer {mock_token}"})
            assert resp.status_code == 201

@pytest.mark.asyncio
async def test_merge_anonymous_favorites(client, mock_token):
    """Verify merging anonymous favorites into a user account."""
    session_id = f"session-{uuid4()}"
    with patch("app.core.config.settings.nextauth_secret", MOCK_SECRET):
        # 1. Create anonymous favorites
        await client.post("/api/ai/favorites", json={
            "bodyId": "499",
            "bodyName": "Mars",
            "question": "Anon Q",
            "answer": "Anon A",
            "sessionId": session_id
        })

        # 2. Call merge
        resp = await client.post("/api/users/merge-anonymous", 
                            json={"session_id": session_id},
                            headers={"Authorization": f"Bearer {mock_token}"})
        
        assert resp.status_code == 200
        assert resp.json()["migrated"] >= 1

@pytest.mark.asyncio
async def test_delete_favorite_anonymous_owned(client):
    """Verify anonymous can delete their own favorite with session_id."""
    session_id = f"session-{uuid4()}"
    create_resp = await client.post("/api/ai/favorites", json={
        "bodyId": "499",
        "bodyName": "Mars",
        "question": "Pergunta delete",
        "answer": "Resposta delete",
        "sessionId": session_id
    })
    assert create_resp.status_code == 201
    fav_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/ai/favorites/{fav_id}?session_id={session_id}")
    assert delete_resp.status_code == 204

