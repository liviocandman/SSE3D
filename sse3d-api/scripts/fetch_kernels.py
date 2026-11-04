#!/usr/bin/env python3
"""Install or verify the image-pinned kernel release. Never overwrite a version."""
from __future__ import annotations

import argparse
import json
import signal
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.kernel_installation import DEFAULT_LOCK, ensure_installation, resolve_kernel_root  # noqa: E402


def cancel(_signum, _frame):
    raise SystemExit(143)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--ensure", action="store_true")
    mode.add_argument("--verify-only", action="store_true")
    parser.add_argument("--kernel-root")
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--source-dir", type=Path, help="Explicit local ZIP/manifest directory, still checked against the HTTPS lock")
    args = parser.parse_args()
    if args.kernel_root is None:
        from app.core.config import settings
        root = settings.spice_kernel_root
    else:
        root = resolve_kernel_root(args.kernel_root)
    try:
        directory, lock = ensure_installation(root, args.lock, source_dir=args.source_dir, verify_only=args.verify_only)
        descriptor = lock["current"]
        print(json.dumps({"result": "verified", "version": descriptor["version"], "archiveSha256": descriptor["archive"]["sha256"],
                          "manifestSha256": descriptor["manifest"]["sha256"], "directory": str(directory), "validationProfile": lock["validationProfile"]}))
        return 0
    except Exception as exc:
        print(f"[kernels] {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, cancel)
    raise SystemExit(main())
