#!/usr/bin/env python3
"""Reproducible ZIP DEFLATE assets, pinned to the recovered inventory."""
from __future__ import annotations

import argparse
import json
import platform
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "sse3d-api"))
from app.services.asset_contract import (  # noqa: E402
    BASIS_PATHS, KERNEL_PATHS, PROFILE, TEXTURE_PATHS, VERSION_RE, sha256, validate_lock,
    validate_manifest, verify_file,
)
from app.services.body_catalog import ALL_BODY_IDS  # noqa: E402


def dump(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")


def entry(path: Path, name: str) -> dict:
    return {"path": name, "bytes": path.stat().st_size, "sha256": sha256(path)}


def package(kind: str, args) -> dict:
    version = f"{kind}-{args.version}"
    if not VERSION_RE.fullmatch(version):
        raise ValueError("invalid version")
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    names = TEXTURE_PATHS if kind == "textures" else sorted(KERNEL_PATHS)
    source = args.textures_root if kind == "textures" else args.kernel_root
    files = []
    ktx = {}
    for name in names:
        relative = name.removeprefix("textures/") if kind == "textures" else name
        path = source / relative
        trusted = next((f for f in baseline[kind] if f["path"] == relative), None)
        if trusted is None:
            raise ValueError(f"baseline missing {name}")
        verify_file(path, trusted)
        files.append(entry(path, name))
        if kind == "textures":
            with path.open("rb") as handle:
                header = handle.read(80)
            if len(header) != 80 or header[:12] != bytes.fromhex("ab4b5458203230bb0d0a1a0a"):
                raise ValueError(f"KTX2 header invalid: {name}")
            ktx[name] = {"identifier": "KTX2", "width": struct.unpack_from("<I", header, 20)[0],
                         "height": struct.unpack_from("<I", header, 24)[0], "levels": struct.unpack_from("<I", header, 40)[0]}
    args.output.mkdir(parents=True, exist_ok=True)
    archive = args.output / f"{version}.zip"
    # Never replace artifacts of an existing version, including un-published local packages.
    if archive.exists():
        raise ValueError(f"output already exists: {archive}; use a fresh output directory")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True) as output:
        for f in files:
            source_path = source / (f["path"].removeprefix("textures/") if kind == "textures" else f["path"])
            info = zipfile.ZipInfo(f["path"], date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info._compresslevel = 9
            with source_path.open("rb") as input_file, output.open(info, "w", force_zip64=True) as destination:
                shutil.copyfileobj(input_file, destination, 4 * 1024**2)
    notes = json.loads((ROOT / "assets/provenance.json").read_text(encoding="utf-8"))[kind]
    manifest = {"schemaVersion": 1, "kind": kind, "version": version, "files": files,
                "originNotes": notes, "packager": {"version": "1", "python": platform.python_version(),
                "zlib": zlib.ZLIB_VERSION, "zlibRuntime": zlib.ZLIB_RUNTIME_VERSION, "compressionLevel": 9}}
    if kind == "textures":
        manifest["ktx2"] = ktx
    else:
        with tempfile.TemporaryDirectory() as temporary:
            report = Path(temporary) / "science.json"
            subprocess.run([sys.executable, str(ROOT / "sse3d-api/scripts/validate_kernels.py"), "--kernel-dir", str(source.resolve()), "--output", str(report)], check=True, timeout=900)
            science = json.loads(report.read_text(encoding="utf-8"))
        manifest.update({"coverage": science.pop("coverage"), "validationProfile": PROFILE, "validation": science})
    validate_manifest(manifest, kind, version)
    manifest_path = args.output / f"{version}.manifest.json"
    dump(manifest_path, manifest)
    (args.output / f"{version}.ATTRIBUTIONS.txt").write_text("\n".join(notes) + "\n", encoding="utf-8", newline="\n")
    base_url = f"https://github.com/liviocandman/SSE3D/releases/download/{version}"
    descriptor = {"version": version, "archive": {"url": f"{base_url}/{archive.name}", **{k: v for k, v in entry(archive, archive.name).items() if k != "path"}},
                  "manifest": {"url": f"{base_url}/{manifest_path.name}", **{k: v for k, v in entry(manifest_path, manifest_path.name).items() if k != "path"}}}
    lock = {"schemaVersion": 1, "kind": kind, "current": descriptor}
    if kind == "textures":
        basis = []
        for name in BASIS_PATHS:
            reference = next(f for f in baseline["basis"] if f["path"] == name.split("/")[-1])
            verify_file(ROOT / name, reference)
            basis.append(entry(ROOT / name, name))
        lock.update({"retained": [], "basis": basis})
    else:
        lock.update({"validationProfile": PROFILE, "requiredBodyIds": ALL_BODY_IDS})
    validate_lock(lock, kind)
    dump(args.output / f"{kind}.lock.json", lock)
    (args.output / f"{version}.sha256").write_text(f"{descriptor['archive']['sha256']}  {archive.name}\n{descriptor['manifest']['sha256']}  {manifest_path.name}\n", encoding="utf-8", newline="\n")
    print(json.dumps({"kind": kind, **descriptor}, indent=2))
    return lock


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("textures", "kernels", "all"))
    parser.add_argument("--version", default="2026-11-04.1")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, default=ROOT / "assets/recovered-inventory.json")
    parser.add_argument("--textures-root", type=Path, default=ROOT / "public/textures")
    parser.add_argument("--kernel-root", type=Path, default=ROOT / "sse3d-api/kernels")
    args = parser.parse_args()
    for kind in ("textures", "kernels") if args.kind == "all" else (args.kind,):
        package(kind, args)


if __name__ == "__main__":
    main()
