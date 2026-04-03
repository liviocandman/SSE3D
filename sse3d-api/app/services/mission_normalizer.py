import datetime
from email.utils import parsedate_to_datetime
from typing import Any, Dict, Iterable, Optional
from loguru import logger
from app.models.mission_schemas import (
    MissionStateResponse,
    MissionDataSource,
    MissionMode,
    MissionPhase,
    MissionPosition,
    MissionVelocity,
    MissionDistances,
    MissionCoordinates,
    MissionHealthResponse,
)

PARSER_VERSION = "epic1-final"
DOY_FORMAT = "%Y:%j:%H:%M:%S"
PARAMETER_KEYS = {
    "timestamp": ("Parameter_2003", "Parameter_1001"),
    "met": ("Parameter_2004",),
    "position_x": ("Parameter_3001",),
    "position_y": ("Parameter_3002",),
    "position_z": ("Parameter_3003",),
    "velocity_x": ("Parameter_3004",),
    "velocity_y": ("Parameter_3005",),
    "velocity_z": ("Parameter_3006",),
    "earth_distance": ("Parameter_5001",),
    "moon_distance": ("Parameter_5002",),
}


def normalize_arow_live_payload(
    raw_payload: Dict[str, Any],
    headers: Dict[str, str],
    fetched_at: str,
) -> MissionStateResponse:
    mission_id = str(raw_payload.get("missionId", raw_payload.get("mission_id", "artemis-2")))
    vehicles = extract_vehicles(raw_payload)
    vehicle = select_vehicle(vehicles)
    vehicle_id = str(vehicle.get("id", vehicle.get("name", "orion")))

    position = extract_position(vehicle)
    velocity = extract_velocity(vehicle)

    source_timestamp_raw = first_present(
        vehicle,
        raw_payload,
        keys=("t", "timestamp", "time", "utc", *PARAMETER_KEYS["timestamp"]),
    )
    source_timestamp, _ = normalize_timestamp(source_timestamp_raw, fallback=fetched_at)
    staleness_seconds = calculate_staleness(source_timestamp_raw or source_timestamp, headers, fetched_at)

    phase = parse_phase(first_present(vehicle, raw_payload, keys=("ph", "phase")))
    distances = extract_distances(vehicle)
    mission_elapsed_time = str(first_present(vehicle, raw_payload, keys=("met", *PARAMETER_KEYS["met"])) or "0-00:00:00")

    return MissionStateResponse(
        missionId=mission_id,
        vehicleId=vehicle_id,
        mode=MissionMode.LIVE,
        phase=phase,
        source=MissionDataSource.AROW_LIVE,
        sourceTimestamp=source_timestamp,
        stalenessSeconds=staleness_seconds,
        position=position,
        velocity=velocity,
        distances=distances,
        missionElapsedTime=mission_elapsed_time,
        globalCoordinates=MissionCoordinates(x=position.x, y=position.y, z=position.z),
        missionCoordinates=MissionCoordinates(x=position.x, y=position.y, z=position.z),
    )


def extract_vehicles(raw_payload: Dict[str, Any]) -> list[Dict[str, Any]]:
    for key in ("v", "vehicles"):
        vehicles = raw_payload.get(key)
        if isinstance(vehicles, list) and vehicles:
            return [vehicle for vehicle in vehicles if isinstance(vehicle, dict)]
    if is_vehicle_like(raw_payload):
        return [raw_payload]
    raise ValueError("No vehicles list found in AROW payload")


def select_vehicle(vehicles: list[Dict[str, Any]]) -> Dict[str, Any]:
    for vehicle in vehicles:
        identifier = str(vehicle.get("id", vehicle.get("name", ""))).lower()
        if "orion" in identifier:
            return vehicle
    return vehicles[0]


def is_vehicle_like(payload: Dict[str, Any]) -> bool:
    keys = set(payload.keys())
    return any(key in keys for key in ("x", "vx", "timestamp", "t", "Parameter_2003"))


def first_present(*sources: Dict[str, Any], keys: Iterable[str]) -> Any:
    for source in sources:
        if not isinstance(source, dict):
            continue
        for key in keys:
            value = source.get(key)
            if value not in (None, ""):
                return value
    return None


def extract_position(vehicle: Dict[str, Any]) -> MissionPosition:
    pos_data = vehicle.get("p") if isinstance(vehicle.get("p"), dict) else vehicle
    return MissionPosition(
        x=to_float(first_present(pos_data, vehicle, keys=("x", *PARAMETER_KEYS["position_x"]))),
        y=to_float(first_present(pos_data, vehicle, keys=("y", *PARAMETER_KEYS["position_y"]))),
        z=to_float(first_present(pos_data, vehicle, keys=("z", *PARAMETER_KEYS["position_z"]))),
    )


def extract_velocity(vehicle: Dict[str, Any]) -> MissionVelocity:
    vel_data = vehicle.get("v") if isinstance(vehicle.get("v"), dict) else vehicle
    return MissionVelocity(
        x=to_float(first_present(vel_data, vehicle, keys=("vx", "x", *PARAMETER_KEYS["velocity_x"]))),
        y=to_float(first_present(vel_data, vehicle, keys=("vy", "y", *PARAMETER_KEYS["velocity_y"]))),
        z=to_float(first_present(vel_data, vehicle, keys=("vz", "z", *PARAMETER_KEYS["velocity_z"]))),
    )


def extract_distances(vehicle: Dict[str, Any]) -> MissionDistances:
    dist_data = vehicle.get("d") if isinstance(vehicle.get("d"), dict) else vehicle
    return MissionDistances(
        earthKm=to_float(first_present(dist_data, vehicle, keys=("e", "earth_km", "distance_earth_km", *PARAMETER_KEYS["earth_distance"]))),
        moonKm=to_float(first_present(dist_data, vehicle, keys=("m", "moon_km", "distance_moon_km", *PARAMETER_KEYS["moon_distance"]))),
    )


def parse_phase(raw_phase: Any) -> MissionPhase:
    phase_val = str(raw_phase or "translunar_coast").lower()
    try:
        return MissionPhase(phase_val)
    except ValueError:
        logger.debug(f"Unknown phase '{phase_val}', falling back to translunar_coast")
        return MissionPhase.TRANSLUNAR_COAST


def normalize_timestamp(raw_timestamp: Any, fallback: Optional[str] = None) -> tuple[str, str]:
    if raw_timestamp not in (None, ""):
        try:
            parsed = parse_known_datetime(str(raw_timestamp))
            fmt = "doy" if is_doy_format(str(raw_timestamp)) else "iso"
            return to_iso_z(parsed), fmt
        except ValueError:
            logger.debug(f"Unsupported timestamp format received: {raw_timestamp}")
    if fallback:
        parsed = parse_known_datetime(fallback)
        return to_iso_z(parsed), "fetch_time"
    raise ValueError("No valid timestamp available")


def calculate_staleness(source_timestamp: Optional[str], headers: Dict[str, str], fetched_at: str) -> float:
    now = datetime.datetime.now(datetime.timezone.utc)

    if source_timestamp:
        try:
            return max(0.0, (now - parse_known_datetime(source_timestamp)).total_seconds())
        except ValueError:
            pass

    last_mod = headers.get("last-modified")
    if last_mod:
        try:
            return max(0.0, (now - parse_http_datetime(last_mod)).total_seconds())
        except ValueError:
            pass

    age_header = headers.get("age")
    if age_header:
        try:
            return max(0.0, float(age_header))
        except Exception:
            pass

    try:
        return max(0.0, (now - parse_known_datetime(fetched_at)).total_seconds())
    except ValueError:
        return 0.0


def parse_known_datetime(raw_value: str) -> datetime.datetime:
    raw_value = str(raw_value).strip()
    if is_doy_format(raw_value):
        return datetime.datetime.strptime(raw_value, DOY_FORMAT).replace(tzinfo=datetime.timezone.utc)
    if "," in raw_value and "GMT" in raw_value:
        return parse_http_datetime(raw_value)
    return datetime.datetime.fromisoformat(raw_value.replace("Z", "+00:00"))


def parse_http_datetime(raw_value: str) -> datetime.datetime:
    parsed = parsedate_to_datetime(raw_value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed.astimezone(datetime.timezone.utc)


def is_doy_format(raw_value: str) -> bool:
    parts = raw_value.split(":")
    return len(parts) == 5 and len(parts[0]) == 4 and len(parts[1]) == 3 and all(part.isdigit() for part in parts)


def to_iso_z(dt: datetime.datetime) -> str:
    return dt.astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def detect_time_format(raw_payload: Dict[str, Any], headers: Dict[str, str], state: MissionStateResponse, fetched_at: str) -> str:
    raw_timestamp = first_present(
        select_vehicle(extract_vehicles(raw_payload)) if raw_payload else {},
        raw_payload,
        keys=("t", "timestamp", "time", "utc", *PARAMETER_KEYS["timestamp"]),
    )
    if raw_timestamp:
        if is_doy_format(str(raw_timestamp)):
            return "doy"
        return "iso"
    if headers.get("last-modified"):
        return "header_last_modified"
    if headers.get("age"):
        return "age"
    if state.source_timestamp == fetched_at:
        return "fetch_time"
    return "unknown"


def detect_raw_source_type(raw_payload: Dict[str, Any]) -> str:
    if isinstance(raw_payload.get("v"), list):
        return "nested_v"
    if isinstance(raw_payload.get("vehicles"), list):
        return "nested_vehicles"
    if is_vehicle_like(raw_payload):
        return "flat_vehicle"
    return "unknown"


def create_mission_health(
    state: MissionStateResponse,
    headers: Dict[str, str],
    fetched_at: str,
    fallback_active: bool = False,
    error_detail: Optional[str] = None,
    raw_payload: Optional[Dict[str, Any]] = None,
) -> MissionHealthResponse:
    status = "nominal"
    if fallback_active:
        status = "degraded"

    if state.staleness_seconds > 600:
        status = "stale"

    details = {
        "etag": headers.get("etag"),
        "lastModified": headers.get("last-modified"),
        "cacheControl": headers.get("cache-control"),
        "ageHeader": headers.get("age"),
        "contentType": headers.get("content-type"),
        "fetchedAt": fetched_at,
        "fallbackActive": fallback_active,
        "error": error_detail,
        "dataAgeSeconds": state.staleness_seconds,
        "parserVersion": PARSER_VERSION,
        "rawSourceType": detect_raw_source_type(raw_payload or {}),
        "timeFormatDetected": detect_time_format(raw_payload or {}, headers, state, fetched_at),
    }

    return MissionHealthResponse(
        missionId=state.mission_id,
        status=status,
        source=state.source,
        lastUpdate=fetched_at,
        currentSource=state.source,
        dataAgeSeconds=state.staleness_seconds,
        fallbackActive=fallback_active,
        coverageStart=None,
        coverageEnd=None,
        details=details,
    )
