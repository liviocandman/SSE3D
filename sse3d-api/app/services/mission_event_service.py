from datetime import datetime, timezone
from typing import Optional

from app.models.mission_schemas import MissionEvent, MissionPhase, MissionEventsResponse
from app.core.config import settings
from app.services.mission_oem_service import mission_oem_service
from app.services.mission_phase_resolver import mission_phase_resolver

ARTEMIS2_ID = "artemis-2"
MISSION_LAUNCH_TIMESTAMP = "2026-04-01T14:00:00Z"
MISSION_TLI_TIMESTAMP = "2026-04-01T16:30:00Z"
DEFAULT_LUNAR_FLYBY_TIMESTAMP = "2026-04-05T08:00:00Z"
DEFAULT_SPLASHDOWN_TIMESTAMP = "2026-04-11T18:00:00Z"

LUNAR_FLYBY_WINDOW_HOURS = 6
LUNAR_RETURN_COAST_START_HOUR = 20
LUNAR_RETURN_COAST_START_MINUTE = 30
REENTRY_LEAD_HOURS = 2


def format_iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_split_timestamp(timestamp: str | None) -> datetime:
    if not timestamp:
        return datetime.now(timezone.utc)

    raw = timestamp.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def format_mission_elapsed_time(timestamp: str) -> str:
    current_dt = parse_split_timestamp(timestamp)
    launch_dt = parse_split_timestamp(MISSION_LAUNCH_TIMESTAMP)
    if current_dt <= launch_dt:
        return "0-00:00:00"

    total_seconds = int((current_dt - launch_dt).total_seconds())
    days, rem = divmod(total_seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, seconds = divmod(rem, 60)
    return f"{days}-{hours:02d}:{minutes:02d}:{seconds:02d}"


class MissionEventService:
    def __init__(self):
        self._events_cache_signature: Optional[tuple[str, str, int, int]] = None
        self._events_cache: Optional[list[MissionEvent]] = None

    async def _build_mission_events(self) -> list[MissionEvent]:
        ephemeris = mission_oem_service.get_ephemeris()
        if ephemeris and ephemeris.states:
            signature = (
                ephemeris.metadata.start_time,
                ephemeris.metadata.stop_time,
                len(ephemeris.states),
                1 if settings.spice_enabled else 0,
            )
            if self._events_cache_signature == signature and self._events_cache is not None:
                return self._events_cache

            launch_dt = parse_split_timestamp(MISSION_LAUNCH_TIMESTAMP)
            tli_dt = parse_split_timestamp(MISSION_TLI_TIMESTAMP)
            _flyby_start_ts, flyby_center_ts, _flyby_end_ts = await mission_phase_resolver.get_lunar_flyby_window(ephemeris)
            flyby_dt = parse_split_timestamp(flyby_center_ts)
            splashdown_dt = parse_split_timestamp(ephemeris.metadata.stop_time)
        else:
            signature = (
                MISSION_LAUNCH_TIMESTAMP,
                DEFAULT_SPLASHDOWN_TIMESTAMP,
                0,
                1 if settings.spice_enabled else 0,
            )
            if self._events_cache_signature == signature and self._events_cache is not None:
                return self._events_cache

            launch_dt = parse_split_timestamp(MISSION_LAUNCH_TIMESTAMP)
            tli_dt = parse_split_timestamp(MISSION_TLI_TIMESTAMP)
            flyby_dt = parse_split_timestamp(DEFAULT_LUNAR_FLYBY_TIMESTAMP)
            splashdown_dt = parse_split_timestamp(DEFAULT_SPLASHDOWN_TIMESTAMP)

        reentry_dt = splashdown_dt
        if splashdown_dt > flyby_dt:
            candidate = splashdown_dt.timestamp() - REENTRY_LEAD_HOURS * 3600
            reentry_dt = datetime.fromtimestamp(max(candidate, flyby_dt.timestamp() + 3600), tz=timezone.utc)

        events = [
            MissionEvent(
                id="launch",
                name="Launch",
                description="SLS launch from KSC",
                timestamp=format_iso_z(launch_dt),
                phase=MissionPhase.LAUNCH,
                isCompleted=False,
            ),
            MissionEvent(
                id="tli",
                name="Trans-Lunar Injection",
                description="ICPS TLI burn",
                timestamp=format_iso_z(tli_dt),
                phase=MissionPhase.EARTH_DEPARTURE,
                isCompleted=False,
            ),
            MissionEvent(
                id="lunar-flyby",
                name="Lunar Flyby",
                description="Closest approach to Moon",
                timestamp=format_iso_z(flyby_dt),
                phase=MissionPhase.LUNAR_FLYBY,
                isCompleted=False,
            ),
            MissionEvent(
                id="reentry",
                name="Reentry Interface",
                description="Earth return entry corridor",
                timestamp=format_iso_z(reentry_dt),
                phase=MissionPhase.REENTRY,
                isCompleted=False,
            ),
            MissionEvent(
                id="splashdown",
                name="Splashdown",
                description="Mission end and recovery",
                timestamp=format_iso_z(splashdown_dt),
                phase=MissionPhase.SPLASHDOWN,
                isCompleted=False,
            ),
        ]

        self._events_cache_signature = signature
        self._events_cache = events
        return events

    async def derive_current_phase(self, reference_dt: datetime, events: list[MissionEvent]) -> MissionPhase:
        event_times = {event.id: parse_split_timestamp(event.timestamp) for event in events}
        flyby_start_ts, _flyby_center_ts, flyby_end_ts = await mission_phase_resolver.get_lunar_flyby_window()
        launch_dt = event_times["launch"]
        tli_dt = event_times["tli"]
        reentry_dt = event_times["reentry"]
        splashdown_dt = event_times["splashdown"]
        flyby_window_start = parse_split_timestamp(flyby_start_ts)
        flyby_window_end = parse_split_timestamp(flyby_end_ts)

        if reference_dt < launch_dt:
            return MissionPhase.LAUNCH
        if reference_dt < tli_dt:
            return MissionPhase.EARTH_DEPARTURE
        if reference_dt < flyby_window_start:
            return MissionPhase.TRANSLUNAR_COAST
        if reference_dt <= flyby_window_end:
            return MissionPhase.LUNAR_FLYBY
        if reference_dt < reentry_dt:
            return MissionPhase.RETURN_COAST
        if reference_dt < splashdown_dt:
            return MissionPhase.REENTRY
        return MissionPhase.SPLASHDOWN

    async def get_mission_events(self, at: Optional[str] = None) -> MissionEventsResponse:
        events = await self._build_mission_events()
        reference_dt = parse_split_timestamp(at)
        current_phase = await self.derive_current_phase(reference_dt, events)

        resolved_events: list[MissionEvent] = []
        next_event: Optional[MissionEvent] = None
        for event in events:
            completed = parse_split_timestamp(event.timestamp) <= reference_dt
            resolved = MissionEvent(
                id=event.id,
                name=event.name,
                description=event.description,
                timestamp=event.timestamp,
                phase=event.phase,
                isCompleted=completed,
            )
            resolved_events.append(resolved)
            if next_event is None and not completed:
                next_event = resolved

        return MissionEventsResponse(
            missionId=ARTEMIS2_ID,
            events=resolved_events,
            currentPhase=current_phase,
            nextEvent=next_event,
        )


mission_event_service = MissionEventService()
