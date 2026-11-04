#!/usr/bin/env python3
"""Real-kernel API/serialization acceptance, isolated from external services."""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.kernel_installation import DEFAULT_LOCK, resolve_kernel_root  # noqa: E402


def finite(value):
    if isinstance(value, float) and not math.isfinite(value):
        raise AssertionError("non-finite API value")
    if isinstance(value, dict):
        for item in value.values():
            finite(item)
    if isinstance(value, list):
        for item in value:
            finite(item)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kernel-root", required=True)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    # This acceptance command does not use the developer's .env service accounts.
    os.environ.update({"SPICE_ENABLED": "true", "SPICE_KERNEL_DIR": str(resolve_kernel_root(args.kernel_root)),
                       "SPICE_LOCK_FILE": str(args.lock.resolve()), "DATABASE_URL": "", "GEMINI_API_KEY": "",
                       "UPSTASH_REDIS_REST_URL": "", "UPSTASH_REDIS_REST_TOKEN": ""})
    from fastapi.testclient import TestClient
    from app.main import app
    from app.services.body_catalog import ALL_BODY_IDS, MOON_PARENTS
    results = []
    started = time.monotonic()
    with TestClient(app) as client:
        ready = client.get("/ready")
        assert ready.status_code == 200, ready.text
        for date in ("1960-01-01", "2000-01-01", "2026-11-02", "2040-01-01"):
            for span, full in ((1, False), (30, False), (1825, False), (30, True)):
                response = client.get("/api/ephemeris", params={"date": date, "ids": ",".join(ALL_BODY_IDS),
                                      "spanDays": span, "fullOrbit": str(full).lower(), "force": "true"})
                assert response.status_code == 200, response.text[:1000]
                payload = response.json()
                finite(payload)
                assert payload["meta"]["source"] == "SPICE_KERNELS", payload["meta"]
                assert {b["bodyId"] for b in payload["data"]} == set(ALL_BODY_IDS)
                assert all(b["trajectory"] for b in payload["data"])
                results.append({"date": date, "spanDays": span, "fullOrbit": full, "bodies": len(payload["data"]),
                                "source": payload["meta"]["source"], "serializedBytes": len(response.content)})
        orbit_results = []
        for full in (False, True):
            for line_only in (False, True):
                response = client.get("/api/ephemeris", params={"date": "2026-11-02", "ids": "399,301,501", "spanDays": 30,
                                      "fullOrbit": str(full).lower(), "force": "true", "orbitReady": "true",
                                      "orbitLineOnly": str(line_only).lower()})
                assert response.status_code == 200, response.text[:1000]
                payload = response.json()
                finite(payload)
                assert payload["meta"]["source"] == "SPICE_KERNELS"
                for body in payload["data"]:
                    if body["bodyId"] in MOON_PARENTS:
                        assert body["orbitLine"] and body["orbitLine"]["points"]
                orbit_results.append({"fullOrbit": full, "orbitReady": True, "orbitLineOnly": line_only,
                                      "source": payload["meta"]["source"], "serializedBytes": len(response.content)})
        report = {"readiness": ready.json(), "apiProbes": results, "orbitReadyProbes": orbit_results,
                  "durationSeconds": time.monotonic() - started,
                  "limitations": "1950/2050 diagnostic limitations are in the pinned manifest; no new coverage or date restriction introduced."}
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"result": "passed", "apiProbes": len(results), "orbitReadyProbes": len(orbit_results), "durationSeconds": report["durationSeconds"]}))


if __name__ == "__main__":
    main()
