"""Pinned asset contract. Importing this module never loads application settings."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

MAX_SAFE_INTEGER = 2**53 - 1
VERSION_RE = re.compile(r"[a-z0-9][a-z0-9._-]{0,79}\Z")
SHA_RE = re.compile(r"[0-9a-f]{64}\Z")
TEXTURE_NAMES = "callisto earth enceladus europa ganymede generic_moon io jupiter mars mercury moon neptune saturn sun titan triton uranus venus saturn_ring".split()
TEXTURE_PATHS = sorted(f"textures/{name}_{tier}.ktx2" for name in TEXTURE_NAMES for tier in ("low", "mid", "high"))
KERNEL_PATHS = ["lsk/naif0012.tls", "spk/de440.bsp", *[f"spk/{name}_min.bsp" for name in ("mar099", "jup365", "sat441", "ura111", "nep081", "plu060")]]
BASIS_PATHS = ["public/basis/basis_transcoder.js", "public/basis/basis_transcoder.wasm"]
PROFILE = "sse3d-spice-v1"
VALIDATOR_VERSION = "1"


class AssetError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssetError(message)


def positive_integer(value) -> bool:
    return type(value) is int and 0 < value <= MAX_SAFE_INTEGER


def safe_path(value: str) -> bool:
    return (isinstance(value, str) and bool(value) and not re.search(r"[\\:\x00-\x1f\x7f]", value)
            and all(p not in ("", ".", "..") for p in value.split("/")))


def validate_file(entry: dict) -> None:
    require(isinstance(entry, dict), "file entry must be an object")
    require(safe_path(entry.get("path")), "unsafe file path")
    require(positive_integer(entry.get("bytes")), "invalid file bytes")
    require(isinstance(entry.get("sha256"), str) and bool(SHA_RE.fullmatch(entry["sha256"])), "invalid file sha256")


def validate_descriptor(descriptor: dict) -> None:
    require(isinstance(descriptor, dict), "descriptor must be an object")
    require(isinstance(descriptor.get("version"), str) and bool(VERSION_RE.fullmatch(descriptor["version"])), "invalid version")
    for name, limit in (("archive", 4 * 1024**3), ("manifest", 2 * 1024**2)):
        entry = descriptor.get(name)
        require(isinstance(entry, dict), f"missing {name}")
        validate_file({**entry, "path": "descriptor"})
        require(entry["bytes"] <= limit, f"{name} exceeds limit")
        require(isinstance(entry.get("url"), str), f"invalid {name} URL")
        try:
            url = urlsplit(entry["url"])
            valid = (url.scheme == "https" and bool(url.hostname) and not url.username and not url.password and not url.fragment)
            _ = url.port
        except ValueError:
            valid = False
        require(valid, f"{name} URL must be HTTPS without credentials")


def validate_lock(lock: dict, kind: str) -> dict:
    require(isinstance(lock, dict) and type(lock.get("schemaVersion")) is int and lock["schemaVersion"] == 1 and lock.get("kind") == kind, "invalid lock schema/kind")
    validate_descriptor(lock.get("current"))
    if kind == "textures":
        require(isinstance(lock.get("retained"), list), "invalid retained list")
        versions = [lock["current"]["version"]]
        for descriptor in lock["retained"]:
            validate_descriptor(descriptor)
            versions.append(descriptor["version"])
        require(len(versions) == len(set(versions)), "duplicate versions")
        require(isinstance(lock.get("basis"), list), "missing Basis inventory")
        for entry in lock["basis"]:
            validate_file(entry)
        require(sorted(e["path"] for e in lock["basis"]) == BASIS_PATHS, "invalid Basis inventory")
    elif kind == "kernels":
        from app.services.body_catalog import ALL_BODY_IDS
        require(lock.get("validationProfile") == PROFILE, "unknown validation profile")
        require(lock.get("requiredBodyIds") == ALL_BODY_IDS, "requiredBodyIds differ from active catalog")
    else:
        raise AssetError("unknown kind")
    return lock


def validate_manifest(manifest: dict, kind: str, version: str) -> dict:
    require(isinstance(manifest, dict) and type(manifest.get("schemaVersion")) is int and manifest["schemaVersion"] == 1 and manifest.get("kind") == kind, "invalid manifest schema/kind")
    require(manifest.get("version") == version, "manifest version mismatch")
    require(isinstance(manifest.get("files"), list), "invalid files")
    for entry in manifest["files"]:
        validate_file(entry)
    expected = TEXTURE_PATHS if kind == "textures" else sorted(KERNEL_PATHS)
    require(sorted(e["path"] for e in manifest["files"]) == expected, "manifest inventory mismatch/duplicate")
    if kind == "textures":
        metadata = manifest.get("ktx2", {})
        require(set(metadata) == set(expected), "missing KTX2 metadata")
        for item in metadata.values():
            require(isinstance(item, dict) and item.get("identifier") == "KTX2" and all(positive_integer(item.get(k)) for k in ("width", "height", "levels")), "invalid KTX2 metadata")
    else:
        require(manifest.get("validationProfile") == PROFILE, "invalid manifest profile")
        require(isinstance(manifest.get("coverage"), dict) and set(manifest["coverage"]) == set(KERNEL_PATHS[1:]), "missing kernel coverage")
    return manifest


def sha256(path: Path) -> str:
    with path.open("rb") as handle:
        digest = hashlib.sha256()
        for chunk in iter(lambda: handle.read(4 * 1024**2), b""):
            digest.update(chunk)
        return digest.hexdigest()


def verify_file(path: Path, entry: dict) -> None:
    require(path.is_file() and not path.is_symlink(), f"missing/unsafe file: {path.name}")
    require(path.stat().st_size == entry["bytes"], f"size mismatch: {path.name}")
    require(sha256(path) == entry["sha256"], f"sha256 mismatch: {path.name}")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))
