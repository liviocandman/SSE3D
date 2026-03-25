import pytest
from pydantic import ValidationError
from app.models.schemas import AstronomerRequest

def test_invalid_date_raises():
    with pytest.raises(ValidationError):
        AstronomerRequest(bodyId="399", date="not-a-date", question="Test question")

def test_unknown_body_id_raises():
    with pytest.raises(ValidationError):
        AstronomerRequest(bodyId="00000", date="2024-01-01", question="Test question")

@pytest.mark.parametrize("body_id", ["301", "401", "501", "601", "701", "801", "901", "999"])
def test_new_body_ids_accepted(body_id):
    req = AstronomerRequest(bodyId=body_id, date="2024-01-01", question="Tell me about this body")
    assert req.body_id == body_id

def test_question_sanitization():
    req = AstronomerRequest(
        bodyId="399",
        date="2024-01-01",
        question="Pergunta\n\ncom\r\nquebras",
    )
    assert "\n" not in req.question
    assert "\r" not in req.question

# --- New context fields ---

def test_moon_request_with_context_fields_accepted():
    """Moon body_id + bodyType/parentName round-trips cleanly."""
    req = AstronomerRequest(
        bodyId="502",          # Europa
        date="2025-01-01",
        question="Existe vida aqui?",
        bodyType="MOON",
        parentName="Jupiter",
    )
    assert req.body_id == "502"
    assert req.body_type == "MOON"
    assert req.parent_name == "Jupiter"

def test_context_fields_are_optional_backward_compat():
    """Omitting bodyType/parentName must NOT break existing callers."""
    req = AstronomerRequest(
        bodyId="399",
        date="2025-01-01",
        question="Qual a gravidade?",
    )
    assert req.body_type is None
    assert req.parent_name is None

@pytest.mark.parametrize("body_id", ["502", "503", "504", "606", "801"])
def test_all_featured_moon_ids_accepted(body_id):
    """Every moon used in the UI must pass schema validation."""
    req = AstronomerRequest(
        bodyId=body_id,
        date="2025-01-01",
        question="Fale sobre este corpo.",
        bodyType="MOON",
    )
    assert req.body_id == body_id
