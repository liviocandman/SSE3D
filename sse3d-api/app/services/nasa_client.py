import asyncio
import re
from datetime import date, timedelta
from typing import Optional
import httpx
from loguru import logger
from app.models.schemas import EphemerisData, EphemerisTrajectory

HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
AU_TO_KM = 149_597_870.7
AU_PER_DAY_TO_KM_PER_SEC = AU_TO_KM / 86_400

BODY_NAMES = {
    "10": "Sun", "199": "Mercury", "299": "Venus", "399": "Earth",
    "499": "Mars", "599": "Jupiter", "699": "Saturn",
    "799": "Uranus", "899": "Neptune", "999": "Pluto",
    "301": "Moon",
    "401": "Phobos", "402": "Deimos",
    "501": "Io", "502": "Europa", "503": "Ganymede", "504": "Callisto",
    "601": "Mimas", "602": "Enceladus", "603": "Tethys", "604": "Dione", "605": "Rhea", "606": "Titan", "608": "Iapetus",
    "701": "Ariel", "702": "Umbriel", "703": "Titania", "704": "Oberon", "705": "Miranda",
    "801": "Triton",
    "901": "Charon",
}

MOON_PARENTS = {
    "301": "399",  # Earth -> Moon
    "401": "499", "402": "499",  # Mars
    "501": "599", "502": "599", "503": "599", "504": "599",  # Jupiter
    "601": "699", "602": "699", "603": "699", "604": "699", "605": "699", "606": "699", "608": "699",  # Saturn
    "701": "799", "702": "799", "703": "799", "704": "799", "705": "799",  # Uranus
    "801": "899",  # Neptune
    "901": "999",  # Pluto
}

def get_step_size(body_id: str, span_days: int = 1) -> str:
    fast = {"501", "601", "602", "701", "705", "401", "402"}
    medium = {"502", "503", "603", "604", "605", "702", "703", "704", "801", "901"}
    slow = {"199", "299", "301", "504", "606", "608"}
    outer = {"399", "499", "599", "699", "799", "899", "999"}

    if span_days > 365:
        if body_id in fast: return "6 h"
        if body_id in medium: return "2 d"
        if body_id in slow: return "4 d"
        if body_id in outer: return "8 d"
    elif span_days > 90:
        if body_id in fast: return "2 h"
        if body_id in medium: return "1 d"
        if body_id in slow: return "2 d"
        if body_id in outer: return "4 d"
    elif span_days > 30:
        if body_id in fast: return "2 h"
        if body_id in medium: return "12 h"
        if body_id in slow: return "1 d"
        if body_id in outer: return "2 d"

    if body_id in fast: return "1 h"
    if body_id in medium: return "6 h"
    if body_id in slow: return "12 h"
    if body_id in outer: return "1 d"
    return "1 d"

def _parse_horizons_csv(
    result: str,
    body_id: str,
    target_date: str,
    parent_id: Optional[str] = None,
) -> Optional[EphemerisData]:
    soe = result.find("$$SOE")
    eoe = result.find("$$EOE")
    if soe == -1 or eoe == -1:
        return None

    csv_data = result[soe + 5:eoe].strip().split('\n')
    
    trajectory = []
    first_pos = None
    first_vel = None
    
    for line in csv_data:
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 8:
            continue
            
        try:
            # Robustly remove "A.D." prefix or infix (e.g., "A.D. 2026-Mar-26" or " A.D. 2026-Mar-26")
            timestamp_str = re.sub(r"A\.D\.\s*", "", parts[1]).strip()
            
            x_au, y_au, z_au = float(parts[2]), float(parts[3]), float(parts[4])
            vx_aud, vy_aud, vz_aud = float(parts[5]), float(parts[6]), float(parts[7])
            
            pos = {
                "x": x_au * AU_TO_KM,
                "y": z_au * AU_TO_KM,
                "z": y_au * AU_TO_KM,
            }
            vel = {
                "x": vx_aud * AU_PER_DAY_TO_KM_PER_SEC,
                "y": vz_aud * AU_PER_DAY_TO_KM_PER_SEC,
                "z": vy_aud * AU_PER_DAY_TO_KM_PER_SEC,
            }
            
            if not first_pos:
                first_pos = pos
                first_vel = vel
                
            trajectory.append(EphemerisTrajectory.model_validate({
                "position": pos,
                "velocity": vel,
                "timestamp": timestamp_str
            }))
        except (ValueError, IndexError):
            continue

    if not trajectory:
        return None

    return EphemerisData.model_validate({
        "bodyId": body_id,
        "name": BODY_NAMES.get(body_id, f"Body {body_id}"),
        "position": first_pos,
        "velocity": first_vel,
        "timestamp": target_date,
        "parentId": parent_id,
        "trajectory": trajectory,
    })


async def _fetch_single(
    client: httpx.AsyncClient,
    body_id: str,
    target_date: str,
    retries: int = 2,
    center_body: str = "10",
    span_days: int = 30,
) -> Optional[EphemerisData]:
    if body_id == "10" and center_body == "10":
        return EphemerisData.model_validate({
            "bodyId": "10",
            "name": "Sun",
            "position": {"x": 0, "y": 0, "z": 0},
            "timestamp": target_date,
            "trajectory": [{
                "position": {"x": 0, "y": 0, "z": 0},
                "velocity": {"x": 0, "y": 0, "z": 0},
                "timestamp": target_date
            }]
        })

    for attempt in range(retries + 1):
        try:
            stop = (date.fromisoformat(target_date) + timedelta(days=span_days)).isoformat()
            
            actual_center = MOON_PARENTS.get(body_id, center_body)

            params = {
                "format": "json",
                "COMMAND": f"'{body_id}'",
                "OBJ_DATA": "NO",
                "MAKE_EPHEM": "YES",
                "EPHEM_TYPE": "VECTORS",
                "CENTER": f"'500@{actual_center}'",
                "START_TIME": f"'{target_date}'",
                "STOP_TIME": f"'{stop}'",
                "STEP_SIZE": f"'{get_step_size(body_id, span_days)}'",
                "VEC_TABLE": "'3'",
                "REF_PLANE": "ECLIPTIC",
                "OUT_UNITS": "'AU-D'",
                "CSV_FORMAT": "YES",
            }

            response = await client.get(HORIZONS_URL, params=params, timeout=20.0)
            
            if response.status_code == 503:
                if attempt < retries:
                    wait_time = 2 * (attempt + 1)
                    logger.warning(f"NASA returned 503 for {body_id}. Retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                    continue
            
            response.raise_for_status()
            data = response.json()
            return _parse_horizons_csv(
                data.get("result", ""),
                body_id,
                target_date,
                parent_id=MOON_PARENTS.get(body_id),
            )
        except (httpx.HTTPError, KeyError, ValueError) as e:
            logger.error(f"Error fetching {body_id} on {target_date} (Attempt {attempt+1}): {e}")
            if attempt < retries:
                await asyncio.sleep(1)
            else:
                return None
    return None


async def fetch_all_parallel(
    body_ids: list[str],
    target_date: str,
    center_body: str = "10",
    span_days: int = 30,
) -> list[EphemerisData]:
    """
    Fetches in small parallel batches to balance latency and NASA 503 limits.
    """
    logger.info(f"Fetching {len(body_ids)} bodies for {target_date} in batches")
    final_results = []
    
    # Batch size of 3 balances speed and NASA tolerance
    BATCH_SIZE = 3
    
    async with httpx.AsyncClient() as client:
        for i in range(0, len(body_ids), BATCH_SIZE):
            batch = body_ids[i:i + BATCH_SIZE]
            tasks = [
                _fetch_single(client, bid, target_date, center_body=center_body, span_days=span_days)
                for bid in batch
            ]
            
            # Run batch in parallel
            results = await asyncio.gather(*tasks)
            final_results.extend([r for r in results if r])
            
            # Brief pause between batches to avoid 503s
            if i + BATCH_SIZE < len(body_ids):
                await asyncio.sleep(0.8)

    return final_results
