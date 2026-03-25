import asyncio
from datetime import date, timedelta
from typing import Optional
import httpx
from loguru import logger
from app.models.schemas import EphemerisData

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

def _parse_horizons_csv(
    result: str,
    body_id: str,
    target_date: str,
    parent_id: Optional[str] = None,
) -> Optional[EphemerisData]:
    """
    Parses CSV format from JPL Horizons.
    CSV format is more stable than text/regex.
    """
    soe = result.find("$$SOE")
    eoe = result.find("$$EOE")
    if soe == -1 or eoe == -1:
        return None

    # Get the CSV line between $$SOE and $$EOE
    csv_line = result[soe + 5:eoe].strip()
    # Fields: JDTDB, Calendar Date, X, Y, Z, VX, VY, VZ
    parts = [p.strip() for p in csv_line.split(",")]
    
    if len(parts) < 8:
        logger.warning(f"Unexpected CSV format for body {body_id}: {csv_line}")
        return None

    try:
        x_au, y_au, z_au = float(parts[2]), float(parts[3]), float(parts[4])
        vx_aud, vy_aud, vz_aud = float(parts[5]), float(parts[6]), float(parts[7])
        
        return EphemerisData.model_validate({
            "bodyId": body_id,
            "name": BODY_NAMES.get(body_id, f"Body {body_id}"),
            "position": {
                "x": x_au * AU_TO_KM,
                "y": z_au * AU_TO_KM,
                "z": y_au * AU_TO_KM,
            },
            "velocity": {
                "x": vx_aud * AU_PER_DAY_TO_KM_PER_SEC,
                "y": vz_aud * AU_PER_DAY_TO_KM_PER_SEC,
                "z": vy_aud * AU_PER_DAY_TO_KM_PER_SEC,
            },
            "timestamp": target_date,
            "parentId": parent_id,
        })
    except (ValueError, IndexError) as e:
        logger.error(f"Error parsing CSV data for {body_id}: {e}")
        return None


async def _fetch_single(
    client: httpx.AsyncClient,
    body_id: str,
    target_date: str,
    retries: int = 2,
    center_body: str = "10",
) -> Optional[EphemerisData]:
    if body_id == "10" and center_body == "10":
        return EphemerisData.model_validate({
            "bodyId": "10",
            "name": "Sun",
            "position": {"x": 0, "y": 0, "z": 0},
            "timestamp": target_date,
        })

    for attempt in range(retries + 1):
        try:
            stop = (date.fromisoformat(target_date) + timedelta(days=1)).isoformat()

            params = {
                "format": "json",
                "COMMAND": f"'{body_id}'",
                "OBJ_DATA": "NO",
                "MAKE_EPHEM": "YES",
                "EPHEM_TYPE": "VECTORS",
                "CENTER": f"'500@{center_body}'",
                "START_TIME": f"'{target_date}'",
                "STOP_TIME": f"'{stop}'",
                "STEP_SIZE": "'1 d'",
                "VEC_TABLE": "'3'",
                "REF_PLANE": "ECLIPTIC",
                "OUT_UNITS": "'AU-D'",
                "CSV_FORMAT": "YES",
            }

            response = await client.get(HORIZONS_URL, params=params, timeout=15.0)
            
            if response.status_code == 503:
                if attempt < retries:
                    wait_time = 2 * (attempt + 1)
                    logger.warning(f"NASA returned 503 for {body_id}. Retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                    continue
            
            response.raise_for_status()
            data = response.json()
            resolved_parent_id = MOON_PARENTS.get(body_id)
            return _parse_horizons_csv(
                data.get("result", ""),
                body_id,
                target_date,
                parent_id=resolved_parent_id,
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
) -> list[EphemerisData]:
    """
    Actually fetches sequentially now to avoid 503 rate limits from NASA.
    """
    logger.info(f"Fetching {len(body_ids)} bodies for {target_date} sequentially")
    final_results = []
    
    async with httpx.AsyncClient() as client:
        for bid in body_ids:
            res = await _fetch_single(client, bid, target_date, center_body=center_body)
            if res:
                final_results.append(res)
            # Small delay between bodies to be nice to NASA
            await asyncio.sleep(0.5)

    return final_results
