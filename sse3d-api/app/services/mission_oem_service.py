from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from loguru import logger

from app.core.config import settings
from app.models.mission_schemas import MissionPosition, MissionVelocity


@dataclass(frozen=True)
class OEMMetadata:
    object_name: str
    object_id: str
    center_name: str
    ref_frame: str
    time_system: str
    start_time: str
    stop_time: str


@dataclass(frozen=True)
class OEMStateVector:
    timestamp: str
    dt: datetime
    position: MissionPosition
    velocity: MissionVelocity


@dataclass(frozen=True)
class OEMEphemeris:
    metadata: OEMMetadata
    states: tuple[OEMStateVector, ...]


def _parse_oem_datetime(raw_value: str) -> datetime:
    parsed = datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


class MissionOEMService:
    def __init__(self, file_path: Optional[str] = None):
        self.file_path = Path(file_path or settings.mission_oem_path)
        self._ephemeris: Optional[OEMEphemeris] = None

    def is_available(self) -> bool:
        return settings.mission_oem_enabled and self.file_path.exists()

    def get_ephemeris(self) -> Optional[OEMEphemeris]:
        if not self.is_available():
            return None
        if self._ephemeris is None:
            self._ephemeris = self._load_ephemeris()
        return self._ephemeris

    def get_state_at(self, timestamp: str) -> Optional[OEMStateVector]:
        ephemeris = self.get_ephemeris()
        if ephemeris is None or not ephemeris.states:
            return None

        target_dt = _parse_oem_datetime(timestamp)
        timeline = [state.dt for state in ephemeris.states]
        index = bisect_left(timeline, target_dt)

        if index <= 0:
            return ephemeris.states[0]
        if index >= len(ephemeris.states):
            return ephemeris.states[-1]

        previous_state = ephemeris.states[index - 1]
        next_state = ephemeris.states[index]

        if next_state.dt == previous_state.dt:
            return previous_state
        if target_dt == next_state.dt:
            return next_state
        if target_dt == previous_state.dt:
            return previous_state

        total_seconds = (next_state.dt - previous_state.dt).total_seconds()
        blend = (target_dt - previous_state.dt).total_seconds() / total_seconds

        return OEMStateVector(
            timestamp=target_dt.isoformat().replace("+00:00", "Z"),
            dt=target_dt,
            position=MissionPosition(
                x=_lerp(previous_state.position.x, next_state.position.x, blend),
                y=_lerp(previous_state.position.y, next_state.position.y, blend),
                z=_lerp(previous_state.position.z, next_state.position.z, blend),
            ),
            velocity=MissionVelocity(
                x=_lerp(previous_state.velocity.x, next_state.velocity.x, blend),
                y=_lerp(previous_state.velocity.y, next_state.velocity.y, blend),
                z=_lerp(previous_state.velocity.z, next_state.velocity.z, blend),
            ),
        )

    def get_states_between(
        self,
        start_timestamp: str,
        end_timestamp: str,
        max_points: int = 120,
    ) -> list[OEMStateVector]:
        ephemeris = self.get_ephemeris()
        if ephemeris is None or not ephemeris.states:
            return []

        start_dt = _parse_oem_datetime(start_timestamp)
        end_dt = _parse_oem_datetime(end_timestamp)
        if end_dt < start_dt:
            start_dt, end_dt = end_dt, start_dt

        filtered = [state for state in ephemeris.states if start_dt <= state.dt <= end_dt]
        if not filtered:
            start_state = self.get_state_at(start_timestamp)
            end_state = self.get_state_at(end_timestamp)
            filtered = [state for state in (start_state, end_state) if state is not None]

        if len(filtered) <= max_points:
            return filtered

        stride = max(1, len(filtered) // max_points)
        sampled = filtered[::stride]
        if sampled[-1].timestamp != filtered[-1].timestamp:
            sampled.append(filtered[-1])
        return sampled[:max_points]

    def _load_ephemeris(self) -> Optional[OEMEphemeris]:
        try:
            raw_lines = self.file_path.read_text(encoding="utf-8").splitlines()
        except Exception as exc:
            logger.error(f"Failed to read OEM file {self.file_path}: {exc}")
            return None

        metadata_map: dict[str, str] = {}
        states: list[OEMStateVector] = []
        inside_meta = False

        for raw_line in raw_lines:
            line = raw_line.strip()
            if not line or line.startswith("COMMENT"):
                continue
            if line == "META_START":
                inside_meta = True
                continue
            if line == "META_STOP":
                inside_meta = False
                continue

            if inside_meta:
                if "=" in line:
                    key, value = [part.strip() for part in line.split("=", 1)]
                    metadata_map[key] = value
                continue

            if "=" in line:
                # Top-level header fields like CCSDS_OEM_VERS / ORIGINATOR are ignored for now.
                continue

            parts = line.split()
            if len(parts) != 7:
                continue

            timestamp = parts[0]
            try:
                dt = _parse_oem_datetime(timestamp)
                x, y, z, vx, vy, vz = map(float, parts[1:])
            except Exception:
                continue

            states.append(
                OEMStateVector(
                    timestamp=timestamp.replace("+00:00", "Z"),
                    dt=dt,
                    position=MissionPosition(x=x, y=y, z=z),
                    velocity=MissionVelocity(x=vx, y=vy, z=vz),
                )
            )

        if not states:
            logger.warning(f"OEM file {self.file_path} produced no state vectors")
            return None

        metadata = OEMMetadata(
            object_name=metadata_map.get("OBJECT_NAME", ""),
            object_id=metadata_map.get("OBJECT_ID", ""),
            center_name=metadata_map.get("CENTER_NAME", ""),
            ref_frame=metadata_map.get("REF_FRAME", ""),
            time_system=metadata_map.get("TIME_SYSTEM", ""),
            start_time=metadata_map.get("START_TIME", states[0].timestamp),
            stop_time=metadata_map.get("STOP_TIME", states[-1].timestamp),
        )

        self._validate_metadata(metadata)
        return OEMEphemeris(metadata=metadata, states=tuple(states))

    def _validate_metadata(self, metadata: OEMMetadata) -> None:
        if metadata.center_name.upper() != "EARTH":
            raise ValueError(f"Unsupported OEM CENTER_NAME: {metadata.center_name}")
        if metadata.ref_frame.upper() != "EME2000":
            raise ValueError(f"Unsupported OEM REF_FRAME: {metadata.ref_frame}")
        if metadata.time_system.upper() != "UTC":
            raise ValueError(f"Unsupported OEM TIME_SYSTEM: {metadata.time_system}")


mission_oem_service = MissionOEMService()
