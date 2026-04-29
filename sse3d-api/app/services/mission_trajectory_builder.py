from app.models.mission_schemas import MissionTrajectoryResponse, MissionTrajectoryPoint, MissionTrajectorySegment, MissionPhase, MissionPosition, MissionVelocity
from app.services.spice_engine import compute_mission_relative_geometry, compute_mission_trajectory
from app.services.mission_geometry_service import enrich_mission_geometry, transform_to_eclipj2000, to_scene_frame, derive_scene_coordinates
from app.services.mission_oem_service import mission_oem_service
from app.services.mission_event_service import mission_event_service, parse_split_timestamp
from app.core.config import settings

ARTEMIS2_ID = "artemis-2"

async def _build_trajectory_point_from_state(
    timestamp: str,
    position: MissionPosition,
    velocity: MissionVelocity,
    segment: MissionTrajectorySegment,
    phase: MissionPhase,
):
    geo_data = await compute_mission_relative_geometry(timestamp)
    if geo_data:
        _global_coords, _mission_coords, scene_coords, _distances = enrich_mission_geometry(
            orion_pos=position,
            orion_vel=velocity,
            earth_pos_eclip=geo_data["earth_pos"],
            moon_pos_eclip=geo_data["moon_pos"],
            et=geo_data["et"],
            input_frame="EME2000",
            input_origin="EARTH",
        )
        rotated_pos, rotated_vel = transform_to_eclipj2000(position, velocity, "EME2000", geo_data["et"])
        _scene_pos, scene_vel = to_scene_frame(rotated_pos, rotated_vel)
        scene_pos = MissionPosition(x=scene_coords.x, y=scene_coords.y, z=scene_coords.z)
        return MissionTrajectoryPoint(
            timestamp=timestamp,
            position=scene_pos,
            velocity=scene_vel,
            phase=phase,
            segment=segment,
        )

    fallback_scene = derive_scene_coordinates(position, velocity, input_frame="EME2000")
    rotated_pos, rotated_vel = transform_to_eclipj2000(position, velocity, "EME2000", 0.0)
    _scene_pos, scene_vel = to_scene_frame(rotated_pos, rotated_vel)
    return MissionTrajectoryPoint(
        timestamp=timestamp,
        position=MissionPosition(x=fallback_scene.x, y=fallback_scene.y, z=fallback_scene.z),
        velocity=scene_vel,
        phase=phase,
        segment=segment,
    )

async def get_mission_trajectory(at: str | None = None) -> MissionTrajectoryResponse:
    """
    Returns the mission trajectory, past and planned points.
    OEM is the primary source for Orion trajectory when available.
    """
    past_points = []
    planned_points = []

    ephemeris = mission_oem_service.get_ephemeris()
    events_list = await mission_event_service._build_mission_events()
    
    if ephemeris and ephemeris.states:
        split_dt = parse_split_timestamp(at)
        states = mission_oem_service.get_states_between(
            ephemeris.metadata.start_time,
            ephemeris.metadata.stop_time,
            max_points=1500,
        )

        for state in states:
            segment = (
                MissionTrajectorySegment.PAST
                if state.dt <= split_dt
                else MissionTrajectorySegment.PLANNED
            )
            phase = await mission_event_service.derive_current_phase(state.dt, events_list)
            point = await _build_trajectory_point_from_state(
                state.timestamp if state.timestamp.endswith("Z") else f"{state.timestamp}Z",
                state.position,
                state.velocity,
                segment,
                phase,
            )
            if segment == MissionTrajectorySegment.PAST:
                past_points.append(point)
            else:
                planned_points.append(point)

        if not past_points and states:
            first = states[0]
            past_points.append(
                await _build_trajectory_point_from_state(
                    first.timestamp if first.timestamp.endswith("Z") else f"{first.timestamp}Z",
                    first.position,
                    first.velocity,
                    MissionTrajectorySegment.PAST,
                    await mission_event_service.derive_current_phase(first.dt, events_list),
                )
            )

        if not planned_points and states:
            last = states[-1]
            planned_points.append(
                await _build_trajectory_point_from_state(
                    last.timestamp if last.timestamp.endswith("Z") else f"{last.timestamp}Z",
                    last.position,
                    last.velocity,
                    MissionTrajectorySegment.PLANNED,
                    await mission_event_service.derive_current_phase(last.dt, events_list),
                )
            )
    else:
        traj_data = await compute_mission_trajectory("2026-04-03T12:00:00Z", "2026-04-05T12:00:00Z", steps=2)
        if traj_data and len(traj_data["times"]) == 2:

            # Start point (past)
            et_start = traj_data["times"][0]
            earth_pos_start = traj_data["earth_pos"][0]
            moon_pos_start = traj_data["moon_pos"][0]

            # End point (planned)
            et_end = traj_data["times"][1]
            earth_pos_end = traj_data["earth_pos"][1]
            moon_pos_end = traj_data["moon_pos"][1]

            # Determine Orion states: try from SPICE, fallback to mock
            if traj_data.get("orion_pos") is not None and len(traj_data["orion_pos"]) == 2:
                orion_start = MissionPosition(
                    x=traj_data["orion_pos"][0][0],
                    y=traj_data["orion_pos"][0][1],
                    z=traj_data["orion_pos"][0][2]
                )
                orion_vel_start = MissionVelocity(
                    x=traj_data["orion_vel"][0][0],
                    y=traj_data["orion_vel"][0][1],
                    z=traj_data["orion_vel"][0][2]
                )
                orion_end = MissionPosition(
                    x=traj_data["orion_pos"][1][0],
                    y=traj_data["orion_pos"][1][1],
                    z=traj_data["orion_pos"][1][2]
                )
                orion_vel_end = MissionVelocity(
                    x=traj_data["orion_vel"][1][0],
                    y=traj_data["orion_vel"][1][1],
                    z=traj_data["orion_vel"][1][2]
                )
                input_frame = "ECLIPJ2000" # Since SPICE returns in ECLIPJ2000
            else:
                # We assume Orion moves from some coords to some coords
                orion_start = MissionPosition(x=100000, y=150000, z=40000)
                orion_vel_start = MissionVelocity(x=1.1, y=-0.4, z=0.05)

                orion_end = MissionPosition(x=350000, y=50000, z=10000)
                orion_vel_end = MissionVelocity(x=0.5, y=-0.2, z=-0.1)
                input_frame = settings.arow_input_frame

            # Enrich the start point
            _global_start, _, scene_start, _ = enrich_mission_geometry(
                orion_start, orion_vel_start, earth_pos_start, moon_pos_start, et_start, input_frame, settings.arow_position_origin
            )
            rotated_start_pos, rotated_start_vel = transform_to_eclipj2000(
                orion_start, orion_vel_start, input_frame, et_start
            )
            _, scene_vel_start = to_scene_frame(rotated_start_pos, rotated_start_vel)
            scene_pos_start = MissionPosition(x=scene_start.x, y=scene_start.y, z=scene_start.z)

            # Enrich the end point
            _global_end, _, scene_end, _ = enrich_mission_geometry(
                orion_end, orion_vel_end, earth_pos_end, moon_pos_end, et_end, input_frame, settings.arow_position_origin
            )
            rotated_end_pos, rotated_end_vel = transform_to_eclipj2000(
                orion_end, orion_vel_end, input_frame, et_end
            )
            _, scene_vel_end = to_scene_frame(rotated_end_pos, rotated_end_vel)
            scene_pos_end = MissionPosition(x=scene_end.x, y=scene_end.y, z=scene_end.z)

            past_points.append(MissionTrajectoryPoint(
                timestamp="2026-04-03T12:00:00Z",
                position=scene_pos_start,
                velocity=scene_vel_start,
                phase=MissionPhase.TRANSLUNAR_COAST,
                segment=MissionTrajectorySegment.PAST
            ))

            planned_points.append(MissionTrajectoryPoint(
                timestamp="2026-04-05T12:00:00Z",
                position=scene_pos_end,
                velocity=scene_vel_end,
                phase=MissionPhase.LUNAR_FLYBY,
                segment=MissionTrajectorySegment.PLANNED
            ))
        else:
            fallback_start_pos, fallback_start_vel = to_scene_frame(
                MissionPosition(x=100000, y=150000, z=40000),
                MissionVelocity(x=1.1, y=-0.4, z=0.05),
            )
            fallback_end_pos, fallback_end_vel = to_scene_frame(
                MissionPosition(x=350000, y=50000, z=10000),
                MissionVelocity(x=0.5, y=-0.2, z=-0.1),
            )
            past_points.append(MissionTrajectoryPoint(
                timestamp="2026-04-03T12:00:00Z",
                position=fallback_start_pos,
                velocity=fallback_start_vel,
                phase=MissionPhase.TRANSLUNAR_COAST,
                segment=MissionTrajectorySegment.PAST
            ))
            planned_points.append(MissionTrajectoryPoint(
                timestamp="2026-04-05T12:00:00Z",
                position=fallback_end_pos,
                velocity=fallback_end_vel,
                phase=MissionPhase.LUNAR_FLYBY,
                segment=MissionTrajectorySegment.PLANNED
            ))
        
    return MissionTrajectoryResponse(
        missionId=ARTEMIS2_ID,
        past=past_points,
        planned=planned_points
    )
