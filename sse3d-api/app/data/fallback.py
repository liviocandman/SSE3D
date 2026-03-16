import json
from pathlib import Path
from typing import Optional
from app.models.schemas import EphemerisData

def load_fallback(body_id: str) -> Optional[EphemerisData]:
    path = Path(__file__).parent / "fallback_planets.json"
    if not path.exists():
        return None
    try:
        json_data = json.loads(path.read_text(encoding="utf-8"))
        items = json_data.get("data", [])
        for item in items:
            if item.get("bodyId") == body_id:
                return EphemerisData.model_validate(item)
    except Exception as e:
        print(f"[Fallback] Error loading data for {body_id}: {e}")
    return None
