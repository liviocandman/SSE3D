from unittest.mock import patch

import pytest

from app.services.spice_kernel_manager import SpiceRuntimeStatus, initialize_spice_kernels


@pytest.mark.asyncio
async def test_orbital_readiness_disabled_and_incomplete(client):
    for status, reason in [(SpiceRuntimeStatus(), "spice_disabled"), (SpiceRuntimeStatus(enabled=True), "spice_not_ready")]:
        with patch("app.main.get_spice_runtime_status", return_value=status):
            response = await client.get("/ready")
            assert response.status_code == 503
            assert response.json()["reason"] == reason
            assert (await client.get("/health")).status_code == 200
            assert "dbReady" not in (await client.get("/health")).json()


@pytest.mark.asyncio
async def test_readiness_requires_complete_verified_set(client):
    status = SpiceRuntimeStatus(enabled=True, ready=True, kernels_present=True, coverage_validated=True,
                                version="kernels-test-1", manifest_sha256="a" * 64, archive_sha256="b" * 64,
                                validation_profile="sse3d-spice-v1", validator_version="1", loaded_files=list(map(str, range(8))))
    with patch("app.main.get_spice_runtime_status", return_value=status):
        assert (await client.get("/ready")).status_code == 200
        status.loaded_files.pop()
        assert (await client.get("/ready")).status_code == 503
        status.loaded_files.append("7")
        status.coverage_validated = False
        assert (await client.get("/ready")).status_code == 503


def test_spice_disabled_never_installs_or_reads_assets():
    with patch("app.services.spice_kernel_manager.settings") as settings, patch("app.services.spice_kernel_manager.read_json", side_effect=AssertionError("no assets")):
        settings.spice_enabled = False
        status = initialize_spice_kernels()
        assert not status.ready and not status.enabled


def test_disabled_lifespan_serves_health_but_never_reads_installs():
    from unittest.mock import AsyncMock
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.config import settings
    with patch.object(settings, "spice_enabled", False), patch("app.main.init_db", new=AsyncMock()), \
         patch("app.services.spice_kernel_manager.verify_installation", side_effect=AssertionError("no assets")):
        with TestClient(app) as http:
            assert http.get("/health").status_code == 200
            response = http.get("/ready")
            assert response.status_code == 503
            assert response.json()["reason"] == "spice_disabled"
