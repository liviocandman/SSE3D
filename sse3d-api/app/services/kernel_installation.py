"""Transactional versioned kernel installation. No application or secrets imports."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path

from app.services.asset_contract import (
    AssetError, KERNEL_PATHS, PROFILE, VALIDATOR_VERSION, read_json, require,
    safe_path, validate_lock, validate_manifest, verify_file,
)

BACKEND_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOCK = BACKEND_ROOT / "assets/kernels.lock.json"
CHUNK_BYTES = 4 * 1024**2


def resolve_kernel_root(value: str | Path) -> Path:
    root = Path(value)
    return root.resolve() if root.is_absolute() else (BACKEND_ROOT / root).resolve()


def effective_directory(root: Path, lock: dict) -> Path:
    return root / "releases" / lock["current"]["version"]


@contextmanager
def installation_lock(root: Path, timeout: float = 90):
    """OS advisory lock: released automatically on process death (Linux/Windows)."""
    root.mkdir(parents=True, exist_ok=True)
    handle = (root / ".install.lock").open("a+b")
    if handle.tell() == 0:
        handle.write(b"\0")
        handle.flush()
    deadline = time.monotonic() + timeout
    acquired = False
    try:
        while not acquired:
            try:
                if os.name == "nt":
                    import msvcrt
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except (BlockingIOError, OSError):
                if time.monotonic() >= deadline:
                    raise AssetError("kernel installation lock timeout") from None
                time.sleep(0.1)
        yield
    finally:
        if acquired:
            if os.name == "nt":
                import msvcrt
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


class TransientDownloadError(Exception):
    pass


def _https_url(value: str) -> str:
    from urllib.parse import urlsplit
    u = urlsplit(value)
    require(u.scheme == "https" and bool(u.hostname) and not u.username and not u.password and not u.fragment, "HTTPS without credentials required")
    return value


async def _download(spec: dict, destination: Path, deadline: float, *, transport=None, backoff: float = 1):
    import httpx
    remaining = deadline - time.monotonic()
    require(remaining > 0, "download deadline exceeded")
    async with asyncio.timeout(remaining):
        async with httpx.AsyncClient(verify=True, follow_redirects=False, transport=transport,
                                     timeout=httpx.Timeout(connect=15, read=60, write=60, pool=15)) as client:
            for attempt in range(3):
                try:
                    url = _https_url(spec["url"])
                    for redirect in range(6):
                        async with client.stream("GET", url, headers={"Accept-Encoding": "identity"}) as response:
                            if response.status_code in (301, 302, 303, 307, 308):
                                from urllib.parse import urljoin
                                require(redirect < 5 and "location" in response.headers, "redirect limit/missing location")
                                url = _https_url(urljoin(url, response.headers["location"]))
                                continue
                            if response.status_code == 429 or 500 <= response.status_code < 600:
                                raise TransientDownloadError(f"HTTP {response.status_code}")
                            require(response.status_code == 200, f"HTTP {response.status_code}")
                            require(response.headers.get("content-encoding", "identity") == "identity", "unexpected content encoding")
                            count = 0
                            with destination.open("xb") as output:
                                async for chunk in response.aiter_bytes(CHUNK_BYTES):
                                    count += len(chunk)
                                    require(count <= spec["bytes"], "download exceeds pinned bytes")
                                    output.write(chunk)
                            verify_file(destination, spec)
                            return
                except (TransientDownloadError, httpx.TimeoutException):
                    destination.unlink(missing_ok=True)
                    if attempt == 2:
                        raise
                    await asyncio.sleep(min(backoff * 2**attempt, 4))
                except BaseException:
                    destination.unlink(missing_ok=True)
                    raise


def download_pinned(spec: dict, destination: Path, deadline: float):
    try:
        asyncio.run(_download(spec, destination, deadline))
    except BaseException:
        destination.unlink(missing_ok=True)
        raise


def obtain_manifest(lock: dict, root: Path, source_dir: Path | None, deadline: float) -> tuple[dict, bytes]:
    descriptor = lock["current"]
    name = f"{descriptor['version']}.manifest.json"
    # An embedded manifest is trusted only after verifying the lock-pinned digest.
    candidates = [source_dir / name] if source_dir is not None else [BACKEND_ROOT / "assets" / name, root / ".downloads" / name]
    for path in candidates:
        if path.exists():
            verify_file(path, descriptor["manifest"])
            return validate_manifest(read_json(path), "kernels", descriptor["version"]), path.read_bytes()
    require(source_dir is None, "explicit local manifest missing")
    downloads = root / ".downloads"
    downloads.mkdir(exist_ok=True)
    temporary = downloads / f"{descriptor['manifest']['sha256']}.{uuid.uuid4().hex}.part"
    try:
        download_pinned(descriptor["manifest"], temporary, min(deadline, time.monotonic() + 30))
        manifest = validate_manifest(read_json(temporary), "kernels", descriptor["version"])
        content = temporary.read_bytes()
        os.replace(temporary, downloads / name)
        return manifest, content
    finally:
        temporary.unlink(missing_ok=True)


def verify_inventory(directory: Path, manifest: dict, *, installed: bool = True):
    require(directory.is_dir() and not directory.is_symlink(), "missing/unsafe installation directory")
    actual = []
    for path in directory.rglob("*"):
        require(not path.is_symlink(), f"symlink in installation: {path.name}")
        if path.is_file():
            actual.append(path.relative_to(directory).as_posix())
        else:
            require(path.is_dir() and path.relative_to(directory).as_posix() in ("lsk", "spk"), "unexpected directory")
    allowed = set(KERNEL_PATHS) | ({"manifest.json", "installation.json"} if installed else set())
    require(set(actual) <= allowed and set(KERNEL_PATHS) <= set(actual), "installed inventory mismatch")
    for entry in manifest["files"]:
        verify_file(directory / entry["path"], entry)


def receipt_for(lock: dict) -> dict:
    descriptor = lock["current"]
    return {"schemaVersion": 1, "version": descriptor["version"], "manifestSha256": descriptor["manifest"]["sha256"],
            "archiveSha256": descriptor["archive"]["sha256"], "validationProfile": PROFILE, "validatorVersion": VALIDATOR_VERSION,
            "requiredBodyIds": lock["requiredBodyIds"]}


def run_science(directory: Path, manifest: dict, deadline: float):
    # Child process isolates CSPICE global state from the HTTP server and installer.
    with tempfile.TemporaryDirectory(prefix=".science-", dir=directory.parent) as temp:
        report = Path(temp) / "report.json"
        child = subprocess.Popen([sys.executable, str(BACKEND_ROOT / "scripts/validate_kernels.py"),
                                  "--kernel-dir", str(directory), "--output", str(report)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            stdout, stderr = child.communicate(timeout=max(0.01, deadline - time.monotonic()))
        except BaseException:
            child.terminate()
            try:
                child.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.communicate()
            raise
        require(child.returncode == 0, f"isolated SPICE validation failed: {stdout[-1000:]} {stderr[-1000:]}")
        result = read_json(report)
        require(result.get("coverage") == manifest["coverage"], "scientific coverage differs from pinned manifest")
        require(result.get("validationProfile") == PROFILE and result.get("validatorVersion") == VALIDATOR_VERSION,
                "scientific validation profile mismatch")


def write_receipt(directory: Path, lock: dict):
    receipt = directory / "installation.json"
    temporary = directory / f".receipt-{uuid.uuid4().hex}.tmp"
    try:
        temporary.write_text(json.dumps(receipt_for(lock), indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(temporary, receipt)
    finally:
        temporary.unlink(missing_ok=True)


def verify_installation(directory: Path, lock: dict, *, repair_receipt: bool = False, science=run_science, deadline=None) -> dict:
    descriptor = lock["current"]
    verify_file(directory / "manifest.json", descriptor["manifest"])
    manifest = validate_manifest(read_json(directory / "manifest.json"), "kernels", descriptor["version"])
    verify_inventory(directory, manifest)
    try:
        receipt = read_json(directory / "installation.json")
        valid = all(receipt.get(k) == v for k, v in receipt_for(lock).items())
    except (OSError, ValueError, AttributeError):
        valid = False
    if not valid:
        require(repair_receipt, "missing/incompatible installation receipt; run --ensure offline")
        science(directory, manifest, deadline or time.monotonic() + 900)
        write_receipt(directory, lock)
    return manifest


def extract_kernels(archive: Path, destination: Path, manifest: dict):
    entries = {entry["path"]: entry for entry in manifest["files"]}
    seen = set()
    with zipfile.ZipFile(archive) as zip_file:
        for info in zip_file.infolist():
            name = info.filename
            require(info.orig_filename == name, "ZIP filename contains NUL")
            directory = info.is_dir()
            require(safe_path(name[:-1] if directory else name), "unsafe ZIP path")
            require(name.lower() not in seen, "duplicate/colliding ZIP entry")
            seen.add(name.lower())
            mode = stat.S_IFMT(info.external_attr >> 16)
            require(mode in (0, stat.S_IFDIR if directory else stat.S_IFREG), "ZIP symlink/special entry")
            require(not info.flag_bits & 1, "encrypted ZIP not allowed")
            if directory:
                require(name in ("lsk/", "spk/") and info.file_size == 0, "unexpected ZIP directory")
                continue
            expected = entries.get(name)
            require(expected is not None and info.file_size == expected["bytes"], "ZIP inventory/size mismatch")
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            count = 0
            with zip_file.open(info) as input_file, target.open("xb") as output:
                for chunk in iter(lambda: input_file.read(CHUNK_BYTES), b""):
                    count += len(chunk)
                    require(count <= expected["bytes"], "extracted bytes exceed manifest")
                    output.write(chunk)
            verify_file(target, expected)
    require(set(entries) <= seen, "ZIP missing required files")


def ensure_installation(root: Path, lock_path: Path = DEFAULT_LOCK, *, source_dir: Path | None = None,
                        verify_only: bool = False, science=run_science, lock_timeout: float = 90) -> tuple[Path, dict]:
    lock = validate_lock(read_json(lock_path), "kernels")
    destination = effective_directory(root, lock)
    deadline = time.monotonic() + 900
    if verify_only:
        verify_installation(destination, lock, science=science, deadline=deadline)
        return destination, lock
    with installation_lock(root, lock_timeout):
        if destination.exists() or destination.is_symlink():
            try:
                verify_installation(destination, lock, repair_receipt=True, science=science, deadline=deadline)
            except Exception as exc:
                raise AssetError(f"installed version corrupt/incompatible; preserved at {destination}: {exc}") from exc
            return destination, lock
        manifest, content = obtain_manifest(lock, root, source_dir, deadline)
        adoptable = True
        try:
            for entry in manifest["files"]:
                verify_file(root / entry["path"], entry)
        except (OSError, AssetError):
            adoptable = False
        required_bytes = sum(entry["bytes"] for entry in manifest["files"])
        if not adoptable:
            required_bytes += lock["current"]["archive"]["bytes"]
        require(shutil.disk_usage(root).free >= (required_bytes * 110 + 99) // 100, "insufficient disk space (new extraction + full archive if needed + 10%)")
        stage_root = root / ".staging"
        stage_root.mkdir(exist_ok=True)
        downloads = root / ".downloads"
        downloads.mkdir(exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix="install-", dir=stage_root))
        part = downloads / f"{lock['current']['archive']['sha256']}.{uuid.uuid4().hex}.zip.part"
        try:
            if adoptable:
                for entry in manifest["files"]:
                    target = staging / entry["path"]
                    target.parent.mkdir(exist_ok=True)
                    shutil.copyfile(root / entry["path"], target)
            else:
                spec = lock["current"]["archive"]
                if source_dir is not None:
                    archive = source_dir / f"{lock['current']['version']}.zip"
                    verify_file(archive, spec)
                    shutil.copyfile(archive, part)
                else:
                    download_pinned(spec, part, deadline)
                verify_file(part, spec)
                extract_kernels(part, staging, manifest)
            verify_inventory(staging, manifest, installed=False)
            science(staging, manifest, deadline)
            (staging / "manifest.json").write_bytes(content)
            write_receipt(staging, lock)
            destination.parent.mkdir(exist_ok=True)
            require(not destination.exists(), "destination appeared during installation")
            staging.rename(destination)
        finally:
            part.unlink(missing_ok=True)
            if staging.exists():
                shutil.rmtree(staging)
        return destination, lock
