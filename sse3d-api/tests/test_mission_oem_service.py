from pathlib import Path

from app.services.mission_oem_service import MissionOEMService


OEM_SAMPLE = """CCSDS_OEM_VERS = 2.0
COMMENT Orion/Planning
CREATION_DATE = 2026-04-03T01:32:08
ORIGINATOR = NASA/JSC/FOD/FDO

META_START
OBJECT_NAME = EM2
OBJECT_ID = 24
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2026-04-02T01:57:37.084
STOP_TIME = 2026-04-10T23:53:24.536
META_STOP

2026-04-02T12:45:30.588 -15162.516812000000 -65859.141377000007 -35577.171827999999 0.91705539100000 -0.04872014700000 -0.02048875900000
2026-04-02T12:47:28.738 -15054.072670276990 -65864.486217764192 -35579.370312456274 0.91865185846199 -0.04175485382938 -0.01672607951341
"""


def test_parse_oem_metadata_and_states(tmp_path: Path):
    oem_path = tmp_path / "orion.asc"
    oem_path.write_text(OEM_SAMPLE, encoding="utf-8")

    service = MissionOEMService(str(oem_path))
    ephemeris = service.get_ephemeris()

    assert ephemeris is not None
    assert ephemeris.metadata.center_name == "EARTH"
    assert ephemeris.metadata.ref_frame == "EME2000"
    assert len(ephemeris.states) == 2
    assert ephemeris.states[0].position.x == -15162.516812


def test_get_state_at_exact_timestamp(tmp_path: Path):
    oem_path = tmp_path / "orion.asc"
    oem_path.write_text(OEM_SAMPLE, encoding="utf-8")

    service = MissionOEMService(str(oem_path))
    state = service.get_state_at("2026-04-02T12:45:30.588Z")

    assert state is not None
    assert state.position.y == -65859.141377000007
    assert state.velocity.x == 0.917055391


def test_get_state_at_interpolates_between_neighbors(tmp_path: Path):
    oem_path = tmp_path / "orion.asc"
    oem_path.write_text(OEM_SAMPLE, encoding="utf-8")

    service = MissionOEMService(str(oem_path))
    state = service.get_state_at("2026-04-02T12:46:29.663Z")

    assert state is not None
    assert state.position.x > -15162.516812
    assert state.position.x < -15054.07267027699
    assert state.velocity.x > 0.917055391
    assert state.velocity.x < 0.91865185846199


def test_get_states_between_returns_window(tmp_path: Path):
    oem_path = tmp_path / "orion.asc"
    oem_path.write_text(OEM_SAMPLE, encoding="utf-8")

    service = MissionOEMService(str(oem_path))
    states = service.get_states_between(
        "2026-04-02T12:45:30.588Z",
        "2026-04-02T12:47:28.738Z",
        max_points=10,
    )

    assert len(states) == 2
    assert states[0].timestamp == "2026-04-02T12:45:30.588"
    assert states[-1].timestamp == "2026-04-02T12:47:28.738"
