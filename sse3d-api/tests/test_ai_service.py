from app.services.ai_service import generate_system_prompt

def test_moon_prompt_mentions_moon_and_parent():
    """Moon prompt must name the moon AND its parent."""
    prompt = generate_system_prompt("502", "2025-01-01", "MOON", "Jupiter")
    assert "Europa" in prompt
    assert "Jupiter" in prompt
    assert "satélite natural" in prompt.lower() or "lua" in prompt.lower()

def test_moon_prompt_without_parent_falls_back_gracefully():
    """parent_name=None must NOT raise — uses generic fallback."""
    prompt = generate_system_prompt("502", "2025-01-01", "MOON", None)
    assert "Europa" in prompt
    assert "seu planeta" in prompt or "planet" in prompt.lower()

def test_planet_prompt_does_not_mention_satellite():
    """Planet prompt must NOT contain moon-specific framing."""
    prompt = generate_system_prompt("599", "2025-01-01", "PLANET", None)
    assert "satélite" not in prompt.lower()
    assert "Júpiter" in prompt or "Jupiter" in prompt

def test_star_prompt_mentions_sol():
    prompt = generate_system_prompt("10", "2025-01-01", "STAR", None)
    assert "Sol" in prompt or "solar" in prompt.lower()

def test_unknown_body_type_defaults_to_planet_framing():
    """Unknown/omitted body_type must produce a safe generic response."""
    prompt = generate_system_prompt("399", "2025-01-01", None, None)
    assert len(prompt) > 20   # non-empty
    assert "satélite" not in prompt.lower()

def test_all_body_labels_covered():
    """Every bodyId in KNOWN_BODY_IDS must resolve to a non-Unknown label."""
    from app.services.ai_service import BODY_LABELS
    from app.models.schemas import KNOWN_BODY_IDS
    for bid in KNOWN_BODY_IDS:
        en, pt = BODY_LABELS.get(bid, (None, None))
        assert en is not None, f"Missing BODY_LABELS entry for bodyId={bid}"
        assert en != "Unknown", f"bodyId={bid} still maps to 'Unknown'"
