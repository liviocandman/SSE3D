from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import spiceypy as spice
from loguru import logger

from app.core.config import settings
from app.services.body_catalog import ALL_BODY_IDS, MOON_PARENTS


@dataclass
class SpiceRuntimeStatus:
    enabled: bool = False
    ready: bool = False
    kernels_present: bool = False
    coverage_validated: bool = False
    loaded_files: list[str] = field(default_factory=list)
    covered_body_ids: list[str] = field(default_factory=list)
    missing_required_ids: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


_status = SpiceRuntimeStatus()


def _resolve_kernel_paths() -> list[Path]:
    root = settings.spice_kernel_root
    configured = [
        settings.spice_lsk_file,
        settings.spice_planetary_spk_file,
        *settings.spice_moon_spk_files,
    ]
    return [(root / rel_path).resolve() for rel_path in configured]


def get_missing_kernel_files() -> list[str]:
    return [str(path) for path in _resolve_kernel_paths() if not path.exists()]


def _check_body_coverage(body_id: str) -> bool:
    if body_id == "10":
        return True

    observer = MOON_PARENTS.get(body_id, "10")
    try:
        spice.spkpos(body_id, 0.0, "ECLIPJ2000", "NONE", observer)
        return True
    except Exception:
        return False


def initialize_spice_kernels(*, validate_coverage: bool = True) -> SpiceRuntimeStatus:
    global _status

    _status = SpiceRuntimeStatus(enabled=settings.spice_enabled)
    if not settings.spice_enabled:
        logger.warning("[SPICE] Disabled via SPICE_ENABLED=false.")
        return _status

    kernel_paths = _resolve_kernel_paths()
    missing_files = get_missing_kernel_files()
    _status.kernels_present = len(missing_files) == 0
    if missing_files:
        _status.errors.append(
            "Missing kernel files: " + ", ".join(missing_files)
        )
        if settings.spice_strict_kernels:
            raise RuntimeError(_status.errors[-1])

    try:
        spice.kclear()
        loaded_files: list[str] = []
        for path in kernel_paths:
            if not path.exists():
                continue
            spice.furnsh(str(path))
            loaded_files.append(str(path))

        _status.loaded_files = loaded_files
    except Exception as exc:
        _status.errors.append(f"Failed to load kernels: {exc}")
        if settings.spice_strict_kernels:
            raise RuntimeError(_status.errors[-1]) from exc
        return _status

    if validate_coverage:
        covered = [body_id for body_id in ALL_BODY_IDS if _check_body_coverage(body_id)]
        missing = [body_id for body_id in ALL_BODY_IDS if body_id not in covered]
        _status.covered_body_ids = covered
        _status.missing_required_ids = missing
        _status.coverage_validated = True

        if missing:
            msg = (
                "[SPICE] Missing body coverage for IDs: " + ", ".join(missing)
            )
            _status.errors.append(msg)
            if settings.spice_strict_kernels:
                raise RuntimeError(msg)
    else:
        _status.covered_body_ids = []
        _status.missing_required_ids = []
        _status.coverage_validated = False

    _status.ready = len(_status.errors) == 0 and len(_status.loaded_files) > 0

    if _status.ready and _status.coverage_validated:
        logger.info(
            "[SPICE] Kernels loaded and coverage validated for {} bodies.",
            len(_status.covered_body_ids),
        )
    elif _status.ready:
        logger.info(
            "[SPICE] Kernels loaded with fast-path startup validation. coverage_validated={}",
            _status.coverage_validated,
        )
    else:
        logger.warning(
            "[SPICE] Partial readiness. Loaded files: {}. Errors: {}",
            len(_status.loaded_files),
            _status.errors,
        )

    return _status


def shutdown_spice_kernels() -> None:
    try:
        spice.kclear()
    finally:
        _status.ready = False


def get_spice_runtime_status() -> SpiceRuntimeStatus:
    return _status


def assert_spice_ready() -> None:
    if not _status.enabled:
        raise RuntimeError("SPICE is disabled by configuration.")
    if not _status.ready:
        raise RuntimeError("SPICE kernels are not ready.")
