from datetime import datetime, timezone
from types import SimpleNamespace

import numpy as np
import pytest

from app.models.mission_schemas import MissionCoordinates, MissionPhase, MissionPosition, MissionVelocity
from app.services import mission_trajectory_builder
from app.services.mission_oem_service import OEMStateVector


def _state(timestamp: str, position: tuple[float, float, float]) -> OEMStateVector:
    dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)
    return OEMStateVector(
        timestamp=timestamp,
        dt=dt,
        position=MissionPosition(x=position[0], y=position[1], z=position[2]),
        velocity=MissionVelocity(x=1.0, y=2.0, z=3.0),
    )


@pytest.mark.asyncio
async def test_oem_trajectory_batches_relative_geometry(monkeypatch):
    states = [
        _state("2026-04-03T12:00:00Z", (100.0, 200.0, 300.0)),
        _state("2026-04-03T12:01:00Z", (110.0, 210.0, 310.0)),
        _state("2026-04-03T12:02:00Z", (120.0, 220.0, 320.0)),
    ]
    ephemeris = SimpleNamespace(
        metadata=SimpleNamespace(
            start_time=states[0].timestamp,
            stop_time=states[-1].timestamp,
        ),
        states=tuple(states),
    )
    batch_calls: list[list[str]] = []

    class FakeOEMService:
        def get_ephemeris(self):
            return ephemeris

        def get_states_between(self, start_timestamp: str, end_timestamp: str, max_points: int):
            assert start_timestamp == states[0].timestamp
            assert end_timestamp == states[-1].timestamp
            assert max_points == 1500
            return states

    class FakeEventService:
        async def _build_mission_events(self):
            return []

        async def derive_current_phase(self, reference_dt, events):
            return MissionPhase.TRANSLUNAR_COAST

    async def fail_point_geometry(timestamp: str):
        raise AssertionError(f"per-point SPICE geometry called for {timestamp}")

    async def fake_batch_geometry(timestamps: list[str]):
        batch_calls.append(timestamps)
        return [
            {
                "et": float(index),
                "earth_pos": np.array([0.0, 0.0, 0.0], dtype=float),
                "moon_pos": np.array([384400.0, 0.0, 0.0], dtype=float),
            }
            for index, _timestamp in enumerate(timestamps)
        ]

    def fake_enrich_geometry(
        orion_pos,
        orion_vel,
        earth_pos_eclip,
        moon_pos_eclip,
        et,
        input_frame,
        input_origin,
    ):
        scene_coords = MissionCoordinates(x=orion_pos.x, y=orion_pos.z, z=-orion_pos.y)
        return None, None, scene_coords, None

    def fake_transform_to_eclipj2000(position, velocity, input_frame, et):
        return position, velocity

    monkeypatch.setattr(mission_trajectory_builder, "mission_oem_service", FakeOEMService())
    monkeypatch.setattr(mission_trajectory_builder, "mission_event_service", FakeEventService())
    monkeypatch.setattr(mission_trajectory_builder, "enrich_mission_geometry", fake_enrich_geometry)
    monkeypatch.setattr(
        mission_trajectory_builder,
        "transform_to_eclipj2000",
        fake_transform_to_eclipj2000,
    )
    monkeypatch.setattr(
        mission_trajectory_builder,
        "compute_mission_relative_geometry",
        fail_point_geometry,
    )
    monkeypatch.setattr(
        mission_trajectory_builder,
        "compute_mission_relative_geometry_batch",
        fake_batch_geometry,
        raising=False,
    )

    response = await mission_trajectory_builder.get_mission_trajectory(
        at="2026-04-03T12:01:30Z"
    )

    assert batch_calls == [[state.timestamp for state in states]]
    assert [point.timestamp for point in response.past] == [
        "2026-04-03T12:00:00Z",
        "2026-04-03T12:01:00Z",
    ]
    assert [point.timestamp for point in response.planned] == [
        "2026-04-03T12:02:00Z",
    ]
    assert response.past[0].position.model_dump() == {"x": 100.0, "y": 300.0, "z": -200.0}
    assert response.past[0].velocity.model_dump() == {"x": 1.0, "y": 3.0, "z": -2.0}
