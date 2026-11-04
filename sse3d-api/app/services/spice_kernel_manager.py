from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import spiceypy as spice
from loguru import logger

from app.core.config import settings
from app.services.asset_contract import KERNEL_PATHS, PROFILE, VALIDATOR_VERSION, read_json, validate_lock
from app.services.body_catalog import ALL_BODY_IDS
from app.services.kernel_installation import effective_directory, verify_installation
from app.services.spice_windows import resolve_target_observer


@dataclass
class SpiceRuntimeStatus:
    enabled: bool = False
    ready: bool = False
    kernels_present: bool = False
    coverage_validated: bool = False
    version: str | None = None
    manifest_sha256: str | None = None
    archive_sha256: str | None = None
    validation_profile: str | None = None
    validator_version: str | None = None
    loaded_files: list[str] = field(default_factory=list)
    covered_body_ids: list[str] = field(default_factory=list)
    missing_required_ids: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


_status = SpiceRuntimeStatus()


def initialize_spice_kernels(kernel_directory: Path | None = None, *, kernel_lock: dict | None = None, validate_coverage: bool = True) -> SpiceRuntimeStatus:
    """Load once before HTTP startup. No downloader, background reload or hot swap."""
    global _status
    if _status.ready:
        raise RuntimeError("SPICE is already active; restart to activate another release")
    _status = SpiceRuntimeStatus(enabled=settings.spice_enabled)
    if not settings.spice_enabled:
        return _status
    try:
        lock = validate_lock(kernel_lock if kernel_lock is not None else read_json(settings.spice_lock_path), "kernels")
        directory = effective_directory(settings.spice_kernel_root, lock) if kernel_directory is None else kernel_directory
        verify_installation(directory, lock)
        descriptor = lock["current"]
        _status.version = descriptor["version"]
        _status.manifest_sha256 = descriptor["manifest"]["sha256"]
        _status.archive_sha256 = descriptor["archive"]["sha256"]
        _status.validation_profile = PROFILE
        _status.validator_version = VALIDATOR_VERSION
        _status.kernels_present = True
        if not validate_coverage:
            raise RuntimeError("runtime coverage validation is required before readiness")
        spice.kclear()
        for name in KERNEL_PATHS:
            path = directory / name
            spice.furnsh(str(path))
            _status.loaded_files.append(str(path))
        for body_id in ALL_BODY_IDS:
            target, observer = resolve_target_observer(body_id)
            try:
                spice.spkpos(target, 0.0, "ECLIPJ2000", "NONE", observer)
                _status.covered_body_ids.append(body_id)
            except Exception:
                _status.missing_required_ids.append(body_id)
        if _status.missing_required_ids:
            raise RuntimeError("Missing required relative-state coverage: " + ", ".join(_status.missing_required_ids))
        if spice.ktotal("ALL") != 8:
            raise RuntimeError("expected exactly eight loaded kernels")
        _status.coverage_validated = True
        _status.ready = len(_status.loaded_files) == 8
        logger.info("[SPICE] version={} kernels=8 profile={} bodies={}", _status.version, PROFILE, len(ALL_BODY_IDS))
    except Exception as exc:
        _status.errors.append(str(exc))
        spice.kclear()
        _status.loaded_files = []
        raise RuntimeError(f"SPICE installation not ready; run scripts/fetch_kernels.py --ensure: {exc}") from exc
    return _status


def shutdown_spice_kernels() -> None:
    try:
        spice.kclear()
    finally:
        _status.ready = False
        _status.loaded_files = []


def get_spice_runtime_status() -> SpiceRuntimeStatus:
    return _status


def assert_spice_ready() -> None:
    if not _status.enabled:
        raise RuntimeError("SPICE is disabled by configuration.")
    if not _status.ready:
        raise RuntimeError("SPICE kernels are not ready.")
