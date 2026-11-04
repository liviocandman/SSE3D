#!/usr/bin/env python3
"""Validate CSPICE in an isolated process; never imports settings, DB or Redis."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.asset_contract import KERNEL_PATHS, PROFILE, VALIDATOR_VERSION  # noqa: E402
from app.services.body_catalog import ALL_BODY_IDS  # noqa: E402
from app.services.spice_windows import _parse_target_datetime, _resolve_window, resolve_target_observer  # noqa: E402


def validate(root: Path) -> dict:
    import numpy as np
    import spiceypy as spice

    coverage = {}
    probes = []
    boundaries = []
    try:
        for name in KERNEL_PATHS:
            spice.furnsh(str(root / name))
        if spice.ktotal("ALL") != 8:
            raise ValueError("expected exactly eight loaded kernels")
        for name in KERNEL_PATHS[1:]:
            entries = []
            for body in spice.spkobj(str(root / name)):
                cell = spice.spkcov(str(root / name), int(body))
                windows = [list(spice.wnfetd(cell, i)) for i in range(spice.wncard(cell))]
                entries.append({"bodyId": str(body), "windowsET": windows,
                                "windowsUTC": [[spice.et2utc(a, "ISOC", 3), spice.et2utc(b, "ISOC", 3)] for a, b in windows]})
            coverage[name] = entries
        # Every required target plus each observer chain must appear in the SPKs.
        present = {e["bodyId"] for entries in coverage.values() for e in entries} | {"0"}
        for body in ALL_BODY_IDS:
            target, observer = resolve_target_observer(body)
            if target not in present or observer not in present:
                raise ValueError(f"SPK chain unavailable: {body} -> {target}/{observer}")
        for date in ("1960-01-01", "2000-01-01", "2026-11-02", "2040-01-01"):
            count = 0
            for body in ALL_BODY_IDS:
                target, observer = resolve_target_observer(body)
                state, _ = spice.spkezr(target, spice.str2et(_parse_target_datetime(date).isoformat()), "ECLIPJ2000", "NONE", observer)
                if not np.isfinite(state).all():
                    raise ValueError(f"nonfinite state: {body}/{date}")
                for span, full in ((1, False), (30, False), (1825, False), (30, True)):
                    if body == "10":
                        continue
                    start, end, steps = _resolve_window(body, date, span, full)
                    times = np.linspace(spice.str2et(start.isoformat()), spice.str2et(end.isoformat()), steps)
                    states, _ = spice.spkezr(target, times, "ECLIPJ2000", "NONE", observer)
                    if not np.isfinite(states).all():
                        raise ValueError(f"nonfinite trajectory: {body}/{date}/{span}/{full}")
                    count += 1
            probes.append({"date": date, "positionBodies": len(ALL_BODY_IDS), "trajectoryWindows": count})
        # Diagnostic only: the recovered satellite SPKs cover ~1950–2050.
        # Long/full-orbit windows can cross coverage even when a point is valid.
        for date in ("1950-01-01", "2050-01-01"):
            for span, full in ((1, False), (30, False), (1825, False), (30, True)):
                failures = []
                for body in ALL_BODY_IDS[1:]:
                    target, observer = resolve_target_observer(body)
                    try:
                        start, end, steps = _resolve_window(body, date, span, full)
                        spice.spkezr(target, np.linspace(spice.str2et(start.isoformat()), spice.str2et(end.isoformat()), steps), "ECLIPJ2000", "NONE", observer)
                    except Exception as exc:
                        failures.append({"bodyId": body, "error": type(exc).__name__})
                boundaries.append({"date": date, "spanDays": span, "fullOrbit": full, "failures": failures})
        return {"validationProfile": PROFILE, "validatorVersion": VALIDATOR_VERSION,
                "requiredBodyIds": ALL_BODY_IDS, "coverage": coverage, "probes": probes,
                "knownBoundaryLimitations": boundaries, "spiceypyVersion": spice.__version__}
    finally:
        spice.kclear()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kernel-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = validate(args.kernel_dir)
        args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"[SPICE validation] {PROFILE}: {len(ALL_BODY_IDS)} bodies accepted")
        return 0
    except Exception as exc:
        print(f"[SPICE validation] {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
