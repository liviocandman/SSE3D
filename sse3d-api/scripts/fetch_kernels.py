#!/usr/bin/env python
from __future__ import annotations

import argparse
import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.request import urlopen

import spiceypy as spice


NAIF_BASE = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels"
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


DEFAULT_KERNELS = [
    KernelFile(
        relative_path="lsk/naif0012.tls",
        url=f"{NAIF_BASE}/lsk/naif0012.tls",
        required=True,
    ),
    KernelFile(
        relative_path="spk/de440s.bsp",
        url=f"{NAIF_BASE}/spk/planets/de440s.bsp",
        required=True,
    ),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download and verify SPICE kernels for SSE3D.",
    )
    parser.add_argument(
        "--kernel-root",
        default=str((Path(__file__).resolve().parents[1] / "kernels")),
        help="Directory where kernels are stored.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download even if file already exists.",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Skip download and only validate local kernels.",
    )
    parser.add_argument(
        "--moon-kernel-url",
        action="append",
        default=[],
        help="URL of compact moon SPK file. Can be passed multiple times.",
    )
    parser.add_argument(
        "--strict-coverage",
        action="store_true",
        help="Exit non-zero if required NAIF IDs are missing.",
    )
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
        print(f"[skip] {dest} already exists")
        return

    ensure_dir(dest.parent)
    print(f"[download] {url} -> {dest}")
    with urlopen(url) as response, dest.open("wb") as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)


def build_kernel_list(moon_urls: list[str]) -> list[KernelFile]:
    kernels = list(DEFAULT_KERNELS)
    for url in moon_urls:
        filename = url.rsplit("/", 1)[-1].strip()
        if not filename:
            continue
        kernels.append(
            KernelFile(
                relative_path=f"spk/{filename}",
                url=url,
                required=True,
            )
        )
    return kernels


def check_coverage(required_ids: Iterable[str]) -> tuple[list[str], list[str]]:
    covered: list[str] = []
    missing: list[str] = []

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
        "coverage": {
            "coveredBodyIds": covered,
            "missingBodyIds": missing,
        },
    }
    manifest_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[manifest] wrote {manifest_path}")


def main() -> int:
    args = parse_args()
    kernel_root = Path(args.kernel_root).resolve()

    env_urls = os.getenv("SSE3D_MOON_KERNEL_URLS", "").strip()
    moon_urls = list(args.moon_kernel_url)
    if env_urls:
        moon_urls.extend([url.strip() for url in env_urls.split(",") if url.strip()])

    kernels = build_kernel_list(moon_urls)

    downloaded: list[dict] = []
    if not args.verify_only:
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

                downloaded.append(
                    {
                        "relativePath": kernel.relative_path,
                        "url": kernel.url,
                        "sha256": checksum,
                    }
                )

    try:
        spice.kclear()
        for kernel in kernels:
            path = kernel_root / kernel.relative_path
            if path.exists():
                spice.furnsh(str(path))

        covered, missing = check_coverage(DEFAULT_REQUIRED_BODY_IDS)
        print(f"[coverage] covered={len(covered)} missing={len(missing)}")
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
