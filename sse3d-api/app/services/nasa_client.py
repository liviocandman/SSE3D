import asyncio
import re
from datetime import datetime, timedelta
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

ORBITAL_PERIODS_DAYS = {
    "199": 88.0, "299": 224.7, "399": 365.25,
    "499": 687.0, "599": 4332.6, "699": 10759.2,
    "799": 30685.4, "899": 60189.0, "999": 90560.0,
    "301": 27.32,
    "401": 0.3189, "402": 1.263,
    "501": 1.769, "502": 3.551, "503": 7.155, "504": 16.689,
    "601": 0.942, "602": 1.370, "603": 1.888, "604": 2.737, "605": 4.518, "606": 15.945, "608": 79.321,
    "701": 2.520, "702": 4.144, "703": 8.706, "704": 13.463, "705": 1.413,
    "801": 5.877,
    "901": 6.387,
}

def calculate_trajectory_params(body_id: str, requested_span: int, full_orbit: bool = False) -> tuple[float, str]:
    """
    Returns (actual_span_days, step_size_string) dynamically calculated.
    If full_orbit is True, calculates a span equal to 100% of the orbital period.
    Targets ~200 points for trails, or ~600 points for full orbits.
    """
    period = ORBITAL_PERIODS_DAYS.get(body_id)
    if not period:
        # Fallback if unknown body
        span = float(requested_span)
        target_points = 600 if full_orbit else 200
        step_hours = max(1, int((span * 24) / target_points))
        return span, f"{step_hours} h"

    is_moon = body_id in MOON_PARENTS
    
    if full_orbit:
        # Full translation: 100% of period
        span = period
        target_points = 600 # Higher density for full static background line
    elif is_moon:
        # Moons: 110% of their orbital period to ensure perfectly closed ring
        span = period * 1.1
        target_points = 200
    else:
        # Planets: ~30° of their orbit (1/12th of period), max 10 years (3650 days)
        span = min(period / 12.0, 3650.0)
        target_points = 200

    total_hours = span * 24.0
    step_hours = max(1, int(total_hours / float(target_points)))

    if step_hours >= 48 and step_hours % 24 == 0:
        return span, f"{step_hours // 24} d"
    elif step_hours >= 24:
        return span, f"{max(1, step_hours // 24)} d"
    elif step_hours >= 1:
        return span, f"{step_hours} h"
    else:
        # For extremely fast moons, step size in minutes
        step_mins = max(1, int((total_hours * 60) / float(target_points)))
        return span, f"{step_mins} m"

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
    full_orbit: bool = False,
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
            actual_span, step_size = calculate_trajectory_params(body_id, span_days, full_orbit=full_orbit)
            
            # For full orbits, we use the start of the current year from target_date
            # to remain in the same general astronomical epoch as the simulation.
            if full_orbit:
                try:
                    if "T" in target_date:
                        year = datetime.fromisoformat(target_date).year
                    else:
                        year = datetime.strptime(target_date, "%Y-%m-%d").year
                except Exception:
                    year = datetime.now().year
                start_dt = datetime(year, 1, 1, 0, 0)
            elif "T" in target_date:
                start_dt = datetime.fromisoformat(target_date)
            else:
                start_dt = datetime.strptime(target_date, "%Y-%m-%d")

            is_moon = body_id in MOON_PARENTS
            if full_orbit:
                # Full orbit: fetch forward from epoch
                real_start_dt = start_dt
                stop_dt = start_dt + timedelta(days=actual_span)
            elif not is_moon and body_id != "10":
                # Planets: Fetch PAST data to create a "tail" (comet effect)
                real_start_dt = start_dt - timedelta(days=actual_span)
                stop_dt = start_dt
            else:
                # Moons/Sun: Keep original forward/centered fetch
                real_start_dt = start_dt
                stop_dt = start_dt + timedelta(days=actual_span)

            horizons_start = real_start_dt.strftime("%Y-%m-%d %H:%M")
            horizons_stop = stop_dt.strftime("%Y-%m-%d %H:%M")
            
            actual_center = MOON_PARENTS.get(body_id, center_body)

            params = {
                "format": "json",
                "COMMAND": f"'{body_id}'",
                "OBJ_DATA": "NO",
                "MAKE_EPHEM": "YES",
                "EPHEM_TYPE": "VECTORS",
                "CENTER": f"'500@{actual_center}'",
                "START_TIME": f"'{horizons_start}'",
                "STOP_TIME": f"'{horizons_stop}'",
                "STEP_SIZE": f"'{step_size}'",
                "VEC_TABLE": "'3'",
                "REF_PLANE": "ECLIPTIC",
                "OUT_UNITS": "'AU-D'",
                "CSV_FORMAT": "YES",
            }

            response = await client.get(HORIZONS_URL, params=params, timeout=30.0) # Increased timeout for large spans
            
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
    full_orbit: bool = False,
) -> list[EphemerisData]:
    """
    Fetches in small parallel batches to balance latency and NASA 503 limits.
    """
    logger.info(f"Fetching {len(body_ids)} bodies for {target_date} in batches (Full Orbit: {full_orbit})")
    final_results = []
    
    # Batch size of 3 balances speed and NASA tolerance
    BATCH_SIZE = 3
    
    async with httpx.AsyncClient() as client:
        for i in range(0, len(body_ids), BATCH_SIZE):
            batch = body_ids[i:i + BATCH_SIZE]
            tasks = [
                _fetch_single(client, bid, target_date, center_body=center_body, span_days=span_days, full_orbit=full_orbit)
                for bid in batch
            ]
            
            # Run batch in parallel
            results = await asyncio.gather(*tasks)
            final_results.extend([r for r in results if r])
            
            # Brief pause between batches to avoid 503s
            if i + BATCH_SIZE < len(body_ids):
                await asyncio.sleep(0.8)

    return final_results

MOON_STEP_SIZE = "1 h"

async def fetch_moon_year(client: httpx.AsyncClient, moon_id: str, parent_id: str, year: int) -> Optional[EphemerisData]:
    """
    Fetches an entire year of high-granularity data for a moon to populate the Redis cache.
    """
    start_dt = datetime(year, 1, 1, 0, 0)
    stop_dt = datetime(year + 1, 1, 1, 0, 0)
    
    horizons_start = start_dt.strftime("%Y-%m-%d %H:%M")
    horizons_stop = stop_dt.strftime("%Y-%m-%d %H:%M")

    params = {
        "format": "json",
        "COMMAND": f"'{moon_id}'",
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "VECTORS",
        "CENTER": f"'500@{parent_id}'",
        "START_TIME": f"'{horizons_start}'",
        "STOP_TIME": f"'{horizons_stop}'",
        "STEP_SIZE": f"'{MOON_STEP_SIZE}'",
        "VEC_TABLE": "'3'",
        "REF_PLANE": "ECLIPTIC",
        "OUT_UNITS": "'AU-D'",
        "CSV_FORMAT": "YES",
    }

    logger.info(f"Fetching full year {year} for Moon {moon_id}...")
    try:
        response = await client.get(HORIZONS_URL, params=params, timeout=120.0)
        response.raise_for_status()
        data = response.json()
        
        parsed = _parse_horizons_csv(
            data.get("result", ""),
            moon_id,
            start_dt.strftime("%Y-%m-%d"),
            parent_id=parent_id,
        )
        return parsed
    except Exception as e:
        logger.error(f"Failed to fetch moon year {moon_id}: {e}")
        return None
