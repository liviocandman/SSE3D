import asyncio
from datetime import date, timedelta
from typing import Optional
import httpx
from app.models.schemas import EphemerisData, Position

HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
AU_TO_KM = 149_597_870.7
AU_PER_DAY_TO_KM_PER_SEC = AU_TO_KM / 86_400

BODY_NAMES = {
    "10": "Sun", "199": "Mercury", "299": "Venus", "399": "Earth",
    "499": "Mars", "599": "Jupiter", "699": "Saturn",
    "799": "Uranus", "899": "Neptune",
}

def _parse_horizons_text(result: str, body_id: str, target_date: str) -> Optional[EphemerisData]:
    soe = result.find("$$SOE")
    eoe = result.find("$$EOE")
    if soe == -1 or eoe == -1:
        return None

    section = result[soe + 5:eoe].strip()
    lines = [l.strip() for l in section.splitlines() if l.strip()]

    pos_line = next((l for l in lines if "X =" in l and "Y =" in l), None)
    vel_line = next((l for l in lines if "VX=" in l and "VY=" in l), None)

    if not pos_line:
        return None

    import re
    nums = re.findall(r"[XYZ]\s*=\s*([-+]?\d+\.?\d*E?[+-]?\d*)", pos_line, re.I)
    if len(nums) < 3:
        return None

    x_au, y_au, z_au = (float(n) for n in nums[:3])
    velocity_data = None
    if vel_line:
        vnums = re.findall(r"V[XYZ]\s*=\s*([-+]?\d+\.?\d*E?[+-]?\d*)", vel_line, re.I)
        if len(vnums) >= 3:
            vx, vy, vz = (float(n) * AU_PER_DAY_TO_KM_PER_SEC for n in vnums[:3])
            velocity_data = {"x": vx, "y": vz, "z": vy}

    return EphemerisData.model_validate({
        "bodyId": body_id,
        "name": BODY_NAMES.get(body_id, f"Body {body_id}"),
        "position": {
            "x": x_au * AU_TO_KM,
            "y": z_au * AU_TO_KM,
            "z": y_au * AU_TO_KM,
        },
        "velocity": velocity_data,
        "timestamp": target_date,
    })


async def _fetch_single(
    client: httpx.AsyncClient,
    body_id: str,
    target_date: str,
) -> Optional[EphemerisData]:
    if body_id == "10":
        return EphemerisData.model_validate({
            "bodyId": "10",
            "name": "Sun",
            "position": {"x": 0, "y": 0, "z": 0},
            "timestamp": target_date,
        })

    try:
        stop = (date.fromisoformat(target_date) + timedelta(days=1)).isoformat()

        params = {
            "format": "json",
            "COMMAND": f"'{body_id}'",
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "VECTORS",
            "CENTER": "'500@10'",
            "START_TIME": f"'{target_date}'",
            "STOP_TIME": f"'{stop}'",
            "STEP_SIZE": "'1 d'",
            "VEC_TABLE": "'3'",
            "REF_PLANE": "ECLIPTIC",
            "OUT_UNITS": "'AU-D'",
            "CSV_FORMAT": "NO",
        }

        response = await client.get(HORIZONS_URL, params=params, timeout=15.0)
        response.raise_for_status()
        data = response.json()
        return _parse_horizons_text(data.get("result", ""), body_id, target_date)
    except (httpx.HTTPError, KeyError, ValueError) as e:
        print(f"[NASA Client] Error fetching {body_id} on {target_date}: {e}")
        return None


async def fetch_all_parallel(
    body_ids: list[str],
    target_date: str,
) -> list[EphemerisData]:
    async with httpx.AsyncClient() as client:
        tasks = [_fetch_single(client, bid, target_date) for bid in body_ids]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    final_results = []
    for r in results:
        if isinstance(r, EphemerisData):
            final_results.append(r)
        elif isinstance(r, Exception):
            print(f"[NASA Client] Async exception caught: {r}")

    return final_results
