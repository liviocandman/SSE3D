import pytest
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_ask_valid_question(client):
    with patch("app.routers.astronomer.check_rate_limit",
               return_value={"allowed": True, "remaining": 4, "reset_seconds": 3600}):
        with patch("app.routers.astronomer.ask_astronomer",
                   new_callable=AsyncMock,
                   return_value="A Terra é o terceiro planeta..."):
            response = await client.post("/api/ai", json={
                "bodyId": "399",
                "date": "2024-01-01",
                "question": "Qual a distância até o Sol?"
            })

    assert response.status_code == 200
    assert "answer" in response.json()

@pytest.mark.asyncio
async def test_rate_limit_returns_429(client):
    with patch("app.routers.astronomer.check_rate_limit",
               return_value={"allowed": False, "remaining": 0, "reset_seconds": 1800}):
        response = await client.post("/api/ai", json={
            "bodyId": "399",
            "date": "2024-01-01",
            "question": "Pergunta qualquer"
        })

    assert response.status_code == 429
    assert response.json()["error"] == "RATE_LIMITED"

@pytest.mark.asyncio
async def test_invalid_body_id_returns_422(client):
    response = await client.post("/api/ai", json={
        "bodyId": "999999",
        "date": "2024-01-01",
        "question": "Pergunta"
    })
    assert response.status_code == 422

@pytest.mark.asyncio
async def test_short_question_returns_422(client):
    response = await client.post("/api/ai", json={
        "bodyId": "399",
        "date": "2024-01-01",
        "question": "ok"
    })
    assert response.status_code == 422

@pytest.mark.asyncio
async def test_moon_body_id_and_context_fields_forwarded(client):
    """Verify moon bodyId + context fields reach ask_astronomer correctly."""
    with patch("app.routers.astronomer.check_rate_limit",
               return_value={"allowed": True, "remaining": 4, "reset_seconds": 3600}):
        with patch("app.routers.astronomer.ask_astronomer",
                   new_callable=AsyncMock,
                   return_value="Europa tem um oceano subsuperficial...") as mock_ask:
            response = await client.post("/api/ai", json={
                "bodyId": "502",
                "date": "2025-01-01",
                "question": "Existe vida aqui?",
                "bodyType": "MOON",
                "parentName": "Jupiter",
            })

    assert response.status_code == 200
    # Verify the service received all context fields
    mock_ask.assert_called_once_with(
        body_id="502",
        target_date="2025-01-01",
        question="Existe vida aqui?",
        body_type="MOON",
        parent_name="Jupiter",
    )

@pytest.mark.asyncio
async def test_legacy_request_without_context_still_works(client):
    """Old callers omitting bodyType/parentName must not break (HTTP 200)."""
    with patch("app.routers.astronomer.check_rate_limit",
               return_value={"allowed": True, "remaining": 4, "reset_seconds": 3600}):
        with patch("app.routers.astronomer.ask_astronomer",
                   new_callable=AsyncMock,
                   return_value="Terra é o terceiro planeta..."):
            response = await client.post("/api/ai", json={
                "bodyId": "399",
                "date": "2025-01-01",
                "question": "Qual a gravidade?",
                # bodyType and parentName intentionally omitted
            })

    assert response.status_code == 200
    assert "answer" in response.json()
