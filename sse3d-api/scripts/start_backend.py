#!/usr/bin/env python3
"""CMD-only bootstrap. Fly release_command runs without this volume consumer."""
import os
import signal
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings  # noqa: E402
from app.services.kernel_installation import ensure_installation  # noqa: E402


def cancel(_signum, _frame):
    raise SystemExit(143)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, cancel)
    if settings.spice_enabled:
        ensure_installation(settings.spice_kernel_root, settings.spice_lock_path)
    arguments = ["app.main:app", "--host", "0.0.0.0", "--port", os.environ.get("PORT", "8080")]
    if os.name == "nt":
        # Windows exec spawns rather than replacing the PID. Keep a supervised
        # child for local development and propagate cancellation on shutdown.
        child = subprocess.Popen([sys.executable, "-m", "uvicorn", *arguments])
        try:
            raise SystemExit(child.wait())
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=10)
    os.execvp("uvicorn", ["uvicorn", *arguments])
