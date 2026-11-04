from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import os
import stat
import subprocess
import sys
import time
import zipfile
from unittest.mock import patch

import httpx
import pytest

from app.services.asset_contract import (
    AssetError, KERNEL_PATHS, PROFILE, read_json, validate_descriptor, validate_lock,
    validate_manifest,
)
from app.services.body_catalog import ALL_BODY_IDS
from app.services.kernel_installation import (
    BACKEND_ROOT, _download, effective_directory, ensure_installation, extract_kernels,
    receipt_for, resolve_kernel_root,
)


def spec(content: bytes) -> dict:
    return {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}


@pytest.fixture
def package(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    bodies = {name: f"synthetic: {name}".encode() for name in KERNEL_PATHS}
    manifest = {"schemaVersion": 1, "kind": "kernels", "version": "kernels-test-1",
                "files": [{"path": path, **spec(body)} for path, body in sorted(bodies.items())],
                "validationProfile": PROFILE, "coverage": {name: [] for name in KERNEL_PATHS[1:]}}
    content = json.dumps(manifest).encode()
    mf = source / "kernels-test-1.manifest.json"
    mf.write_bytes(content)
    archive = source / "kernels-test-1.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
        for name, body in bodies.items():
            output.writestr(name, body)
    lock = {"schemaVersion": 1, "kind": "kernels", "current": {
        "version": manifest["version"], "archive": {"url": "https://fixture.invalid/a.zip", **spec(archive.read_bytes())},
        "manifest": {"url": "https://fixture.invalid/m.json", **spec(content)}},
        "validationProfile": PROFILE, "requiredBodyIds": ALL_BODY_IDS}
    lock_file = tmp_path / "lock.json"
    lock_file.write_text(json.dumps(lock))
    return {"source": source, "manifest": manifest, "lock": lock, "lock_file": lock_file,
            "bodies": bodies, "root": tmp_path / "volume", "archive": archive}


def accept_science(*args):
    pass


def install(package, **kwargs):
    return ensure_installation(package["root"], package["lock_file"], source_dir=package["source"], science=accept_science, **kwargs)


def test_shared_descriptor_contract():
    for case in read_json(BACKEND_ROOT.parent / "assets/test-fixtures/descriptors.json"):
        if case["valid"]:
            validate_descriptor(case["value"])
        else:
            with pytest.raises((AssetError, ValueError, TypeError), match="."):
                validate_descriptor(case["value"])


@pytest.mark.parametrize("change", [{"schemaVersion": 2}, {"kind": "textures"}, {"requiredBodyIds": []}, {"validationProfile": "unknown"}])
def test_invalid_lock(package, change):
    with pytest.raises(AssetError):
        validate_lock({**package["lock"], **change}, "kernels")


@pytest.mark.parametrize("change", [{"schemaVersion": 2}, {"kind": "textures"}, {"version": "bad"}, {"files": []}])
def test_invalid_manifest(package, change):
    with pytest.raises(AssetError):
        validate_manifest({**package["manifest"], **change}, "kernels", "kernels-test-1")


def test_directory_resolution():
    assert resolve_kernel_root("kernels") == BACKEND_ROOT / "kernels"
    assert resolve_kernel_root(BACKEND_ROOT / "other") == BACKEND_ROOT / "other"


def test_install_verify_offline_and_repair_receipt(package):
    directory, _ = install(package)
    assert directory == effective_directory(package["root"], package["lock"])
    assert sorted(p.relative_to(directory).as_posix() for p in directory.rglob("*.bsp")) == sorted(KERNEL_PATHS[1:])
    with patch("app.services.kernel_installation.download_pinned", side_effect=AssertionError("network forbidden")):
        install(package, verify_only=True)
        install(package)
        (directory / "installation.json").unlink()
        with pytest.raises(AssetError, match="receipt"):
            install(package, verify_only=True)
        calls = []
        ensure_installation(package["root"], package["lock_file"], science=lambda *args: calls.append(1))
        assert calls == [1]
        assert read_json(directory / "installation.json") == receipt_for(package["lock"])
        (directory / "installation.json").write_text('{"validationProfile":"other"}')
        ensure_installation(package["root"], package["lock_file"], science=lambda *args: calls.append(1))
        assert calls == [1, 1]


def test_legacy_adoption_copies_and_preserves(package):
    root = package["root"]
    for name, body in package["bodies"].items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    package["archive"].unlink()  # Cannot possibly obtain a ZIP.
    with patch("app.services.kernel_installation.download_pinned", side_effect=AssertionError("network forbidden")):
        directory, _ = install(package)
    for name, body in package["bodies"].items():
        assert (root / name).read_bytes() == body == (directory / name).read_bytes()
        assert not os.path.samefile(root / name, directory / name)


def test_legacy_mismatch_no_adoption(package):
    p = package["root"] / KERNEL_PATHS[0]
    p.parent.mkdir(parents=True)
    p.write_bytes(b"wrong legacy")
    directory, _ = install(package)
    assert p.read_bytes() == b"wrong legacy"
    assert (directory / KERNEL_PATHS[0]).read_bytes() == package["bodies"][KERNEL_PATHS[0]]


def test_corrupt_installed_version_preserved(package):
    directory, _ = install(package)
    (directory / KERNEL_PATHS[0]).write_bytes(b"bad")
    with pytest.raises(AssetError, match="preserved"):
        install(package)
    assert (directory / KERNEL_PATHS[0]).read_bytes() == b"bad"


def test_science_failure_and_update_preserve_previous(package):
    old, _ = install(package)
    new_lock = copy.deepcopy(package["lock"])
    new_lock["current"]["version"] = "kernels-test-2"
    package["lock_file"].write_text(json.dumps(new_lock))
    with pytest.raises(AssetError):
        install(package)
    assert (old / "manifest.json").is_file()
    package["lock_file"].write_text(json.dumps(package["lock"]))
    import shutil
    shutil.rmtree(old)
    def reject(*args):
        raise AssetError("science rejected")
    with pytest.raises(AssetError, match="science rejected"):
        ensure_installation(package["root"], package["lock_file"], source_dir=package["source"], science=reject)
    assert not old.exists()
    assert not list((package["root"] / ".staging").iterdir())
    assert not list((package["root"] / ".downloads").glob("*.part"))


def test_insufficient_space_fails_before_staging(package):
    from collections import namedtuple
    disk = namedtuple("Disk", "total used free")(1, 1, 0)
    with patch("app.services.kernel_installation.shutil.disk_usage", return_value=disk), pytest.raises(AssetError, match="disk space"):
        install(package)
    assert not (package["root"] / ".staging").exists()


@pytest.mark.parametrize("name", ["../escape", "/escape", "C:/escape", "spk\\escape", "spk/../escape", "spk/unexpected", "spk/DE440.bsp"])
def test_malicious_zip_paths(package, tmp_path, name):
    bad = tmp_path / "bad.zip"
    with zipfile.ZipFile(bad, "w") as output:
        output.writestr(name, b"evil")
    destination = tmp_path / "stage"
    destination.mkdir()
    with pytest.raises(AssetError):
        extract_kernels(bad, destination, package["manifest"])
    assert not list(destination.iterdir())
    assert not (tmp_path / "escape").exists()


@pytest.mark.parametrize("mode", ["symlink", "duplicate", "missing", "oversize", "sha", "truncated"])
def test_invalid_zip(package, tmp_path, mode):
    bad = tmp_path / "bad.zip"
    entries = list(package["bodies"].items())
    if mode == "missing":
        entries.pop()
    if mode == "duplicate":
        entries.append(entries[0])
    with zipfile.ZipFile(bad, "w", zipfile.ZIP_DEFLATED) as output:
        for index, (name, body) in enumerate(entries):
            info = zipfile.ZipInfo(name)
            if index == 0 and mode == "symlink":
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
            if index == 0 and mode == "oversize":
                body = b"x" * 10000
            if index == 0 and mode == "sha":
                body = b"x" * len(body)
            output.writestr(info, body)
    if mode == "truncated":
        bad.write_bytes(bad.read_bytes()[:-10])
    destination = tmp_path / "stage"
    destination.mkdir()
    with pytest.raises((AssetError, zipfile.BadZipFile)):
        extract_kernels(bad, destination, package["manifest"])


@pytest.mark.parametrize("status,expected_calls", [(403, 1), (404, 1), (429, 3), (500, 3), (503, 3), (600, 1)])
@pytest.mark.asyncio
async def test_download_http_retry_budget(tmp_path, status, expected_calls):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status)
    with pytest.raises(Exception):
        await _download({"url": "https://fixture.invalid/zip", **spec(b"ok")}, tmp_path / "part", time.monotonic() + 1, transport=httpx.MockTransport(handler), backoff=0.001)
    assert len(calls) == expected_calls
    assert not (tmp_path / "part").exists()


@pytest.mark.asyncio
async def test_download_streaming_checksum_timeout_deadline_tls(tmp_path):
    path = tmp_path / "part"
    s = {"url": "https://fixture.invalid/a", **spec(b"ok")}
    await _download(s, path, time.monotonic() + 1, transport=httpx.MockTransport(lambda req: httpx.Response(200, content=b"ok")))
    assert path.read_bytes() == b"ok"
    path.unlink()
    for body in (b"too long", b"no"):
        with pytest.raises(AssetError):
            await _download(s, path, time.monotonic() + 1, transport=httpx.MockTransport(lambda req: httpx.Response(200, content=body)))
    calls = []
    def timeout(req):
        calls.append(req)
        raise httpx.ReadTimeout("fixture timeout")
    with pytest.raises(httpx.ReadTimeout):
        await _download(s, path, time.monotonic() + 1, transport=httpx.MockTransport(timeout), backoff=0.001)
    assert len(calls) == 3
    async def slow(req):
        await asyncio.sleep(1)
        return httpx.Response(200)
    with pytest.raises(TimeoutError):
        await _download(s, path, time.monotonic() + 0.01, transport=httpx.MockTransport(slow))
    calls = []
    def cert(req):
        calls.append(req)
        raise httpx.ConnectError("CERTIFICATE_VERIFY_FAILED")
    with pytest.raises(httpx.ConnectError):
        await _download(s, path, time.monotonic() + 1, transport=httpx.MockTransport(cert))
    assert len(calls) == 1
    with pytest.raises(AssetError, match="HTTPS"):
        await _download(s, path, time.monotonic() + 1, transport=httpx.MockTransport(lambda req: httpx.Response(302, headers={"location": "http://insecure.invalid/a"})))


def test_two_installers_and_process_death_release_lock(package):
    # The same production OS lock is used in each process. Only the expensive science
    # callback is replaced; synthetic files must never be treated as real science.
    script = """import sys,time
from pathlib import Path
from app.services.kernel_installation import ensure_installation
ensure_installation(Path(sys.argv[1]),Path(sys.argv[2]),source_dir=Path(sys.argv[3]),science=lambda *a: time.sleep(0.1))
"""
    args = [sys.executable, "-c", script, str(package["root"]), str(package["lock_file"]), str(package["source"])]
    processes = [subprocess.Popen(args, cwd=BACKEND_ROOT) for _ in range(2)]
    assert [p.wait(timeout=15) for p in processes] == [0, 0]
    marker = package["root"] / "locked"
    script = """import sys,time
from pathlib import Path
from app.services.kernel_installation import installation_lock
with installation_lock(Path(sys.argv[1])):
 Path(sys.argv[2]).write_text('locked')
 time.sleep(30)
"""
    child = subprocess.Popen([sys.executable, "-c", script, str(package["root"]), str(marker)], cwd=BACKEND_ROOT)
    try:
        until = time.monotonic() + 10
        while not marker.exists() and time.monotonic() < until:
            time.sleep(0.05)
        assert marker.exists()
    finally:
        child.kill()
        child.wait(timeout=5)
    install(package, lock_timeout=1)


@pytest.mark.asyncio
async def test_production_transport_rejects_real_untrusted_tls(tmp_path, monkeypatch):
    import ssl
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    fixtures = BACKEND_ROOT.parent / "assets/test-fixtures"
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(fixtures / "tls-cert.txt", fixtures / "tls-key.txt")
    server.socket = context.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setenv("NO_PROXY", "localhost,127.0.0.1")
    try:
        with pytest.raises(httpx.ConnectError, match="CERTIFICATE_VERIFY_FAILED"):
            await _download({"url": f"https://localhost:{server.server_port}/a", **spec(b"ok")}, tmp_path / "part", time.monotonic() + 10)
        assert not (tmp_path / "part").exists()
    finally:
        server.shutdown()
        server.server_close()
