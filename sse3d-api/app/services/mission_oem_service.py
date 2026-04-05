from __future__ import annotations

import io
import zipfile
import numpy as np
from bisect import bisect_left
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import httpx
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


def _normalize(vec: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vec)
    if norm <= 0:
        return vec
    return vec / norm


def _as_optional_path(value: Optional[str]) -> Optional[Path]:
    if not value:
        return None
    return Path(value).expanduser().resolve()


class MissionOEMService:
    def __init__(
        self,
        file_path: Optional[str] = None,
        source_url: Optional[str] = None,
        cache_dir: Optional[str] = None,
    ):
        self.file_path = _as_optional_path(file_path if file_path is not None else settings.mission_oem_path)
        raw_source_url = source_url if source_url is not None else settings.mission_oem_url
        self.source_url = raw_source_url.strip().strip("'\"")
        self.cache_dir = _as_optional_path(cache_dir if cache_dir is not None else settings.mission_oem_cache_dir)
        self.refresh_seconds = max(0, int(settings.mission_oem_refresh_seconds))
        self.download_timeout_seconds = max(1.0, float(settings.mission_oem_download_timeout_seconds))
        if self.file_path is None and not self.source_url:
            autodetected = self._discover_workspace_oem_file()
            if autodetected is not None:
                logger.info(f"Mission OEM autodetected from workspace: {autodetected}")
                self.file_path = autodetected

        self._ephemeris: Optional[OEMEphemeris] = None
        self._adaptive_states: Optional[tuple[OEMStateVector, ...]] = None
        self._loaded_source_file: Optional[Path] = None
        self._cached_download_file: Optional[Path] = None

    def _discover_workspace_oem_file(self) -> Optional[Path]:
        try:
            repo_root = Path(__file__).resolve().parents[3]
            ephemeris_dir = repo_root / "public" / "ephemeris"
            if not ephemeris_dir.exists():
                return None

            candidates = sorted(
                (
                    path for path in ephemeris_dir.glob("*")
                    if path.is_file() and path.suffix.lower() in {".asc", ".oem", ".txt"}
                ),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            return candidates[0] if candidates else None
        except Exception:
            return None

    def is_available(self) -> bool:
        if not settings.mission_oem_enabled:
            return False
        return self._resolve_source_file() is not None

    def get_ephemeris(self) -> Optional[OEMEphemeris]:
        if not settings.mission_oem_enabled:
            return None

        source_file = self._resolve_source_file()
        if source_file is None:
            return None

        if self._loaded_source_file != source_file:
            self._ephemeris = None
            self._adaptive_states = None
            self._loaded_source_file = source_file

        if self._ephemeris is None:
            self._ephemeris = self._load_ephemeris(source_file)
            if self._ephemeris:
                logger.info(f"Building adaptive trajectory cache from {len(self._ephemeris.states)} states")
                self._adaptive_states = self._build_adaptive_trajectory(self._ephemeris.states)
                logger.info(f"Adaptive cache built: {len(self._adaptive_states)} states")
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
        use_adaptive: bool = True,
    ) -> list[OEMStateVector]:
        ephemeris = self.get_ephemeris()
        if ephemeris is None:
            return []

        source_states = ephemeris.states
        if use_adaptive and self._adaptive_states is not None:
            source_states = self._adaptive_states

        start_dt = _parse_oem_datetime(start_timestamp)
        end_dt = _parse_oem_datetime(end_timestamp)
        if end_dt < start_dt:
            start_dt, end_dt = end_dt, start_dt

        filtered = [state for state in source_states if start_dt <= state.dt <= end_dt]
        if not filtered:
            start_state = self.get_state_at(start_timestamp)
            end_state = self.get_state_at(end_timestamp)
            filtered = [state for state in (start_state, end_state) if state is not None]

        if len(filtered) <= max_points:
            return filtered

        stride = max(1, len(filtered) // max_points)
        sampled = filtered[::stride]
        if sampled[-1].dt != filtered[-1].dt:
            sampled.append(filtered[-1])
        return sampled[:max_points]

    def _resolve_source_file(self) -> Optional[Path]:
        if self.source_url:
            remote = self._ensure_remote_oem_cached()
            if remote is not None:
                return remote

        if self.file_path and self.file_path.exists():
            logger.warning("Mission OEM remote source unavailable; falling back to local OEM file.")
            return self.file_path

        return None

    def _ensure_remote_oem_cached(self) -> Optional[Path]:
        if self.cache_dir is None:
            return None

        self.cache_dir.mkdir(parents=True, exist_ok=True)
        cached_file = self._cached_download_file
        if cached_file is None:
            existing = self.cache_dir / "artemis2_latest.oem"
            if existing.exists():
                cached_file = existing
                self._cached_download_file = existing

        if cached_file and cached_file.exists() and self.refresh_seconds > 0:
            age_seconds = max(0.0, datetime.now(timezone.utc).timestamp() - cached_file.stat().st_mtime)
            if age_seconds <= self.refresh_seconds:
                return cached_file

        try:
            payload, name_hint = self._download_source_payload(self.source_url)
            downloaded_file = self._write_oem_payload(payload, name_hint)
            if downloaded_file:
                self._cached_download_file = downloaded_file
                return downloaded_file
        except Exception as exc:
            logger.warning(f"Mission OEM download failed: {exc}")

        if cached_file and cached_file.exists():
            logger.warning(f"Using last cached OEM file after download failure: {cached_file}")
            return cached_file

        return None

    def _download_source_payload(self, source_url: str) -> tuple[bytes, str]:
        parsed = urlparse(source_url)
        scheme = parsed.scheme.lower()

        if scheme in ("http", "https"):
            response = httpx.get(
                source_url,
                timeout=self.download_timeout_seconds,
                follow_redirects=True,
                headers={
                    "User-Agent": settings.arow_user_agent,
                    "Accept": "application/zip, application/octet-stream, */*",
                },
            )
            response.raise_for_status()
            hint = Path(parsed.path).name or "remote.oem"
            content_type = (response.headers.get("content-type") or "").lower()
            if "text/html" in content_type:
                raise RuntimeError(
                    f"OEM URL returned HTML instead of a zip/oem payload (content-type={content_type}). "
                    "Check if the URL is a landing page, expired signed URL, or blocked by network policy."
                )
            return response.content, hint

        if scheme == "s3":
            try:
                import boto3  # type: ignore
            except Exception as exc:
                raise RuntimeError("boto3 is required for s3:// mission_oem_url sources") from exc

            bucket = parsed.netloc
            key = parsed.path.lstrip("/")
            if not bucket or not key:
                raise ValueError(f"Invalid s3 URL for mission OEM source: {source_url}")

            client = boto3.client("s3")
            obj = client.get_object(Bucket=bucket, Key=key)
            body = obj["Body"].read()
            return body, Path(key).name

        raise ValueError(f"Unsupported mission_oem_url scheme: {source_url}")

    def _write_oem_payload(self, payload: bytes, name_hint: str) -> Optional[Path]:
        if self.cache_dir is None:
            return None

        if zipfile.is_zipfile(io.BytesIO(payload)):
            with zipfile.ZipFile(io.BytesIO(payload), "r") as zf:
                names = [name for name in zf.namelist() if not name.endswith("/")]
                if not names:
                    raise ValueError("OEM zip payload is empty")

                preferred = [
                    name for name in names
                    if Path(name).suffix.lower() in {".asc", ".oem", ".txt"}
                ]
                selected_name = preferred[0] if preferred else names[0]
                extracted_payload = zf.read(selected_name)
                return self._write_atomic(extracted_payload, Path(selected_name).suffix.lower() or ".oem")

        suffix = Path(name_hint).suffix.lower() or ".oem"
        return self._write_atomic(payload, suffix)

    def _write_atomic(self, payload: bytes, suffix: str) -> Path:
        target = self.cache_dir / f"artemis2_latest{suffix}"
        tmp_target = target.with_suffix(f"{target.suffix}.tmp")
        tmp_target.write_bytes(payload)
        tmp_target.replace(target)

        canonical = self.cache_dir / "artemis2_latest.oem"
        if canonical != target:
            canonical.write_bytes(target.read_bytes())
            target = canonical

        return target

    def _build_adaptive_trajectory(
        self,
        states: tuple[OEMStateVector, ...],
        near_earth_dense_km: float = 250000.0,
        angular_dot_threshold: float = 0.998,
        segment_dot_threshold: float = 0.9985,
        lunar_window_points: int = 260,
        lunar_min_distance_km: float = 300000.0,
        hard_limit: int = 1500,
    ) -> tuple[OEMStateVector, ...]:
        if not states:
            return ()

        positions = np.array(
            [[s.position.x, s.position.y, s.position.z] for s in states],
            dtype=float,
        )
        distances = np.linalg.norm(positions, axis=1)
        apogee_idx = int(np.argmax(distances))
        lunar_window_start = max(0, apogee_idx - lunar_window_points)
        lunar_window_end = min(len(states) - 1, apogee_idx + lunar_window_points)

        kept_states: list[OEMStateVector] = [states[0]]
        protected_indices: set[int] = {0, len(states) - 1}
        kept_index_set: set[int] = {0}

        last_pos_vec = positions[0]
        last_unit_vec = _normalize(last_pos_vec)

        for i in range(1, len(states) - 1):
            state = states[i]
            pos_vec = positions[i]
            dist_km = distances[i]
            lunar_zone = (
                lunar_window_start <= i <= lunar_window_end
                and dist_km >= lunar_min_distance_km
            )

            if lunar_zone:
                kept_states.append(state)
                kept_index_set.add(i)
                protected_indices.add(i)
                last_pos_vec = pos_vec
                last_unit_vec = _normalize(pos_vec)
                continue

            if dist_km <= near_earth_dense_km:
                kept_states.append(state)
                kept_index_set.add(i)
                protected_indices.add(i)
                last_pos_vec = pos_vec
                last_unit_vec = _normalize(pos_vec)
                continue

            unit_vec = _normalize(pos_vec)
            dot = np.dot(last_unit_vec, unit_vec)

            if dot < angular_dot_threshold:
                kept_states.append(state)
                kept_index_set.add(i)
                last_pos_vec = pos_vec
                last_unit_vec = unit_vec
                continue

            prev_state = states[i - 1]
            next_state = states[i + 1]
            incoming_vec = np.array([
                state.position.x - prev_state.position.x,
                state.position.y - prev_state.position.y,
                state.position.z - prev_state.position.z,
            ])
            outgoing_vec = np.array([
                next_state.position.x - state.position.x,
                next_state.position.y - state.position.y,
                next_state.position.z - state.position.z,
            ])
            incoming_unit = _normalize(incoming_vec)
            outgoing_unit = _normalize(outgoing_vec)

            if np.linalg.norm(incoming_unit) > 0 and np.linalg.norm(outgoing_unit) > 0:
                segment_dot = np.dot(incoming_unit, outgoing_unit)
                if segment_dot < segment_dot_threshold:
                    kept_states.append(state)
                    kept_index_set.add(i)
                    last_pos_vec = pos_vec
                    last_unit_vec = unit_vec
                    continue

        if (len(states) - 1) not in kept_index_set:
            kept_states.append(states[-1])
            kept_index_set.add(len(states) - 1)

        if len(kept_states) <= hard_limit:
            return tuple(kept_states)

        ordered_kept = sorted(kept_index_set)
        protected_kept = [idx for idx in ordered_kept if idx in protected_indices]
        flexible_kept = [idx for idx in ordered_kept if idx not in protected_indices]

        if len(protected_kept) >= hard_limit:
            sampled = set(np.linspace(0, len(protected_kept) - 1, hard_limit, dtype=int).tolist())
            selected = [protected_kept[i] for i in sorted(sampled)]
            selected[0] = 0
            selected[-1] = len(states) - 1
            return tuple(states[idx] for idx in sorted(set(selected)))

        remaining = hard_limit - len(protected_kept)
        if remaining <= 0:
            return tuple(states[idx] for idx in protected_kept)

        if len(flexible_kept) <= remaining:
            selected_indices = sorted(protected_kept + flexible_kept)
            return tuple(states[idx] for idx in selected_indices)

        flexible_positions = np.linspace(0, len(flexible_kept) - 1, remaining, dtype=int)
        selected_flexible = [flexible_kept[i] for i in sorted(set(flexible_positions.tolist()))]
        selected_indices = sorted(set(protected_kept + selected_flexible))
        return tuple(states[idx] for idx in selected_indices)

    def _load_ephemeris(self, source_file: Path) -> Optional[OEMEphemeris]:
        try:
            raw_lines = source_file.read_text(encoding="utf-8").splitlines()
        except Exception as exc:
            logger.error(f"Failed to read OEM file {source_file}: {exc}")
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
            logger.warning(f"OEM file {source_file} produced no state vectors")
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
