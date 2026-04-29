from datetime import datetime, timezone
from typing import Optional

from app.core.config import settings
from app.services.mission_oem_service import mission_oem_service
from app.services.spice_engine import compute_mission_relative_geometry
from app.services.mission_geometry_service import transform_to_eclipj2000

class MissionPhaseResolver:
    def __init__(self):
        self._lunar_flyby_window_cache_signature: Optional[tuple[str, str, int, int]] = None
        self._lunar_flyby_window_cache: Optional[tuple[str, str, str]] = None

    def _resolve_lunar_return_coast_start(self, reference_dt: datetime) -> datetime:
        from app.services.mission_event_service import LUNAR_RETURN_COAST_START_HOUR, LUNAR_RETURN_COAST_START_MINUTE
        transition_dt = reference_dt.astimezone(timezone.utc).replace(
            hour=LUNAR_RETURN_COAST_START_HOUR,
            minute=LUNAR_RETURN_COAST_START_MINUTE,
            second=0,
            microsecond=0,
        )
        if transition_dt <= reference_dt:
            return reference_dt
        return transition_dt

    def _fallback_lunar_flyby_window(self, center_timestamp: str) -> tuple[str, str, str]:
        from app.services.mission_event_service import parse_split_timestamp, format_iso_z, LUNAR_FLYBY_WINDOW_HOURS
        center_dt = parse_split_timestamp(center_timestamp)
        start_dt = datetime.fromtimestamp(
            center_dt.timestamp() - LUNAR_FLYBY_WINDOW_HOURS * 3600,
            tz=timezone.utc,
        )
        end_dt = self._resolve_lunar_return_coast_start(center_dt)
        return (
            format_iso_z(start_dt),
            format_iso_z(center_dt),
            format_iso_z(end_dt),
        )

    async def _derive_lunar_flyby_window(self, ephemeris) -> tuple[str, str, str]:
        from app.services.mission_event_service import DEFAULT_LUNAR_FLYBY_TIMESTAMP
        if not settings.spice_enabled:
            return self._fallback_lunar_flyby_window(DEFAULT_LUNAR_FLYBY_TIMESTAMP)

        states = mission_oem_service.get_states_between(
            ephemeris.metadata.start_time,
            ephemeris.metadata.stop_time,
            max_points=1500,
            use_adaptive=True,
        )
        if not states:
            return self._fallback_lunar_flyby_window(DEFAULT_LUNAR_FLYBY_TIMESTAMP)

        valid_samples: list[tuple[str, datetime, float, float]] = []
        input_frame = ephemeris.metadata.ref_frame or "EME2000"

        for state in states:
            timestamp = state.timestamp if state.timestamp.endswith("Z") else f"{state.timestamp}Z"
            geo_data = await compute_mission_relative_geometry(timestamp)
            if not geo_data:
                continue

            rotated_pos, _ = transform_to_eclipj2000(state.position, state.velocity, input_frame, geo_data["et"])
            earth_distance = float((rotated_pos.x ** 2 + rotated_pos.y ** 2 + rotated_pos.z ** 2) ** 0.5)
            moon_rel_eclip = geo_data["moon_pos"] - geo_data["earth_pos"]
            dx = rotated_pos.x - float(moon_rel_eclip[0])
            dy = rotated_pos.y - float(moon_rel_eclip[1])
            dz = rotated_pos.z - float(moon_rel_eclip[2])
            moon_distance = float((dx ** 2 + dy ** 2 + dz ** 2) ** 0.5)
            valid_samples.append((timestamp, state.dt, earth_distance, moon_distance))

        if not valid_samples:
            return self._fallback_lunar_flyby_window(DEFAULT_LUNAR_FLYBY_TIMESTAMP)

        closest_idx = min(range(len(valid_samples)), key=lambda index: valid_samples[index][3])
        if valid_samples[closest_idx][3] >= valid_samples[closest_idx][2]:
            return self._fallback_lunar_flyby_window(valid_samples[closest_idx][0])

        start_idx = closest_idx
        while start_idx > 0 and valid_samples[start_idx - 1][3] < valid_samples[start_idx - 1][2]:
            start_idx -= 1

        end_idx = closest_idx
        while end_idx < len(valid_samples) - 1 and valid_samples[end_idx + 1][3] < valid_samples[end_idx + 1][2]:
            end_idx += 1

        if start_idx == end_idx:
            return self._fallback_lunar_flyby_window(valid_samples[closest_idx][0])

        closest_dt = valid_samples[closest_idx][1]
        derived_end_dt = valid_samples[end_idx][1]
        capped_end_dt = min(derived_end_dt, self._resolve_lunar_return_coast_start(closest_dt))
        end_idx = next(
            (
                index
                for index in range(closest_idx, len(valid_samples))
                if valid_samples[index][1] >= capped_end_dt
            ),
            end_idx,
        )

        return (
            valid_samples[start_idx][0],
            valid_samples[closest_idx][0],
            valid_samples[end_idx][0],
        )

    async def get_lunar_flyby_window(self, ephemeris=None) -> tuple[str, str, str]:
        from app.services.mission_event_service import MISSION_LAUNCH_TIMESTAMP, DEFAULT_SPLASHDOWN_TIMESTAMP, DEFAULT_LUNAR_FLYBY_TIMESTAMP
        target_ephemeris = ephemeris or mission_oem_service.get_ephemeris()
        if target_ephemeris and target_ephemeris.states:
            signature = (
                target_ephemeris.metadata.start_time,
                target_ephemeris.metadata.stop_time,
                len(target_ephemeris.states),
                1 if settings.spice_enabled else 0,
            )
            if self._lunar_flyby_window_cache_signature == signature and self._lunar_flyby_window_cache is not None:
                return self._lunar_flyby_window_cache

            window = await self._derive_lunar_flyby_window(target_ephemeris)
            self._lunar_flyby_window_cache_signature = signature
            self._lunar_flyby_window_cache = window
            return window

        fallback_signature = (
            MISSION_LAUNCH_TIMESTAMP,
            DEFAULT_SPLASHDOWN_TIMESTAMP,
            0,
            1 if settings.spice_enabled else 0,
        )
        if self._lunar_flyby_window_cache_signature == fallback_signature and self._lunar_flyby_window_cache is not None:
            return self._lunar_flyby_window_cache

        window = self._fallback_lunar_flyby_window(DEFAULT_LUNAR_FLYBY_TIMESTAMP)
        self._lunar_flyby_window_cache_signature = fallback_signature
        self._lunar_flyby_window_cache = window
        return window


mission_phase_resolver = MissionPhaseResolver()
