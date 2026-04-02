#!/usr/bin/env python
from __future__ import annotations

import argparse
import hashlib
import json
import os
import ssl
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.request import urlopen

import spiceypy as spice

S3_BASE_URL = os.getenv("S3_KERNELS_URL", "").rstrip("/")
NASA_BASE_URL = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels"

DEFAULT_REQUIRED_BODY_IDS = [
    "10", "199", "299", "399", "499", "599", "699", "799", "899", "999",
    "301", "401", "402", "501", "502", "503", "504", "601", "602", "603", "604",
    "605", "606", "608", "701", "702", "703", "704", "705", "801", "901",
]

MOON_PARENTS = {
    "301": "399", "401": "499", "402": "499", "501": "599", "502": "599",
    "503": "599", "504": "599", "601": "699", "602": "699", "603": "699",
    "604": "699", "605": "699", "606": "699", "608": "699", "701": "799",
    "702": "799", "703": "799", "704": "799", "705": "799", "801": "899",
    "901": "999",
}

@dataclass
class KernelFile:
    relative_path: str
    url: str
    required: bool = True
    sha256: str | None = None

def get_kernel_list() -> list[KernelFile]:
    if not S3_BASE_URL:
        print("⚠️ WARNING: S3_KERNELS_URL not defined in environment. Using empty base (will fail on S3).")

    return [
        # The Leap Seconds Kernel is tiny (50KB), we can fetch it directly from NASA without risk.
        KernelFile(
            relative_path="lsk/naif0012.tls",
            url=f"{NASA_BASE_URL}/lsk/naif0012.tls"
        ),
        # All other heavy files come from S3 vault, optimized.
        KernelFile(relative_path="spk/de440.bsp", url=f"{S3_BASE_URL}/spk/de440.bsp"),
        KernelFile(relative_path="spk/mar099_min.bsp", url=f"{S3_BASE_URL}/spk/mar099_min.bsp"),
        KernelFile(relative_path="spk/jup365_min.bsp", url=f"{S3_BASE_URL}/spk/jup365_min.bsp"),
        KernelFile(relative_path="spk/sat441_min.bsp", url=f"{S3_BASE_URL}/spk/sat441_min.bsp"),
        KernelFile(relative_path="spk/ura111_min.bsp", url=f"{S3_BASE_URL}/spk/ura111_min.bsp"),
        KernelFile(relative_path="spk/nep081_min.bsp", url=f"{S3_BASE_URL}/spk/nep081_min.bsp"),
        KernelFile(relative_path="spk/plu060_min.bsp", url=f"{S3_BASE_URL}/spk/plu060_min.bsp"),
    ]

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync SPICE kernels from S3.")
    parser.add_argument("--kernel-root", default="kernels", help="Directory where kernels are stored.")
    parser.add_argument("--force", action="store_true", help="Re-download even if file exists.")
    parser.add_argument("--strict-coverage", action="store_true", help="Exit non-zero if IDs are missing.")
    return parser.parse_args()

def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)

def sha256sum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()

def download_file(url: str, dest: Path, force: bool) -> None:
    if dest.exists() and not force:
        print(f"[skip] {dest.name} already exists in volume")
        return

    ensure_dir(dest.parent)
    print(f"[download] {url} -> {dest}")

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    try:
        with urlopen(url, context=ctx) as response, dest.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024 * 5) # 5MB chunks for speed
                if not chunk:
                    break
                output.write(chunk)
    except Exception as e:
        print(f"❌ Critical error downloading {url}: {e}")
        if dest.exists():
            dest.unlink() # Delete corrupted file to not break the cache

def check_coverage(required_ids: Iterable[str]) -> tuple[list[str], list[str]]:
    covered, missing = [], []
    for body_id in required_ids:
        if body_id == "10":
            covered.append(body_id)
            continue
        observer = MOON_PARENTS.get(body_id, "10")
        try:
            spice.spkpos(body_id, 0.0, "ECLIPJ2000", "NONE", observer)
            covered.append(body_id)
        except Exception:
            missing.append(body_id)
    return covered, missing

def write_manifest(kernel_root: Path, downloaded: list[dict], covered: list[str], missing: list[str]) -> None:
    manifest_path = kernel_root / "manifest.json"
    payload = {
        "kernelRoot": str(kernel_root),
        "files": downloaded,
        "coverage": {"coveredBodyIds": covered, "missingBodyIds": missing},
    }
    manifest_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[manifest] wrote {manifest_path}")

def main() -> int:
    args = parse_args()
    kernel_root = Path(args.kernel_root).resolve()
    kernels = get_kernel_list()
    
    # Rigorous boot validation: If S3 is not configured, we stop here
    if not S3_BASE_URL:
        print("❌ FAILED: S3_KERNELS_URL is missing. Cannot fetch physics data.")
        return 1

    downloaded: list[dict] = []
    
    print(f"🚀 Starting kernel verification in destination folder: {kernel_root}")
    
    for kernel in kernels:
        destination = kernel_root / kernel.relative_path
        download_file(kernel.url, destination, args.force)

        if not destination.exists() and kernel.required:
            print(f"[error] required kernel missing: {destination}")
            return 1

        if destination.exists():
            checksum = sha256sum(destination)
            if kernel.sha256 and checksum.lower() != kernel.sha256.lower():
                print(f"[error] checksum mismatch for {destination}")
                return 1

            downloaded.append({"relativePath": kernel.relative_path, "url": kernel.url, "sha256": checksum})

    try:
        spice.kclear()
        for kernel in kernels:
            path = kernel_root / kernel.relative_path
            if path.exists():
                spice.furnsh(str(path))

        covered, missing = check_coverage(DEFAULT_REQUIRED_BODY_IDS)
        print(f"[coverage] SPICE Kernel Engine loaded: covered={len(covered)} missing={len(missing)}")
        if missing:
            print("[coverage] missing IDs:", ", ".join(missing))

        write_manifest(kernel_root, downloaded, covered, missing)

        if args.strict_coverage and missing:
            return 1
        return 0
    finally:
        spice.kclear()

if __name__ == "__main__":
    raise SystemExit(main())