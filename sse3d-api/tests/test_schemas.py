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
