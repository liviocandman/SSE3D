import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildTrajectorySegment, type TrajectorySegment } from "@/lib/trajectoryEngine";
import {
  MissionDataSource,
  MissionMode,
  MissionPhase,
  MissionTrajectorySegment,
  type MissionState,
  type MissionTrajectory,
} from "@/lib/missionTypes";
import { sampleMission } from "@/lib/simulation/missionSampler";

function createEarthSegments(): TrajectorySegment[] {
  const segment = buildTrajectorySegment([
    {
      timestamp: "2026-04-10T00:00:00Z",
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    },
    {
      timestamp: "2026-04-10T01:00:00Z",
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    },
  ]);

  if (!segment) {
    throw new Error("Expected earth segment");
  }

  return [segment];
}

function createMissionTrajectory(): { trajectory: MissionTrajectory; segment: TrajectorySegment } {
  const points = [
    {
      timestamp: "2026-04-10T00:00:00Z",
      position: { x: 10, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      segment: MissionTrajectorySegment.PAST,
      phase: MissionPhase.TRANSLUNAR_COAST,
    },
    {
      timestamp: "2026-04-10T00:00:01Z",
      position: { x: 20, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      segment: MissionTrajectorySegment.PLANNED,
      phase: MissionPhase.TRANSLUNAR_COAST,
    },
  ];

  const segment = buildTrajectorySegment(points.map((point) => ({
    timestamp: point.timestamp,
    position: point.position,
    velocity: point.velocity,
  })));

  if (!segment) {
    throw new Error("Expected mission segment");
  }

  return {
    trajectory: {
      missionId: "artemis2",
      past: [points[0]],
      planned: [points[1]],
    },
    segment,
  };
}

function createMissionState(mode: MissionMode, sourceTimestamp: string): MissionState {
  return {
    missionId: "artemis2",
    vehicleId: "orion",
    mode,
    phase: MissionPhase.TRANSLUNAR_COAST,
    source: MissionDataSource.AROW_LIVE,
    sourceTimestamp,
    stalenessSeconds: 0,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    distances: { earthKm: 0, moonKm: 0 },
    missionElapsedTime: "PT0S",
    sceneCoordinates: { x: 999, y: 0, z: 0 },
  };
}

describe("sampleMission", () => {
  it("prefers trajectory sampling in replay when telemetry timestamp does not match render time", () => {
    const { trajectory, segment } = createMissionTrajectory();
    const outAbsolute = new THREE.Vector3();
    const outRelative = new THREE.Vector3();
    const outHeading = new THREE.Quaternion();

    const source = sampleMission(
      Date.parse("2026-04-10T00:00:00Z"),
      createMissionState(MissionMode.REPLAY, "2026-04-10T00:00:10Z"),
      trajectory,
      segment,
      createEarthSegments(),
      outAbsolute,
      outRelative,
      outHeading,
    );

    expect(source).toBe("trajectory");
    expect(outRelative.x).toBe(10);
  });

  it("keeps telemetry coordinates as authoritative in live mode", () => {
    const { trajectory, segment } = createMissionTrajectory();
    const outAbsolute = new THREE.Vector3();
    const outRelative = new THREE.Vector3();
    const outHeading = new THREE.Quaternion();

    const source = sampleMission(
      Date.parse("2026-04-10T00:00:00Z"),
      createMissionState(MissionMode.LIVE, "2026-04-10T00:00:10Z"),
      trajectory,
      segment,
      createEarthSegments(),
      outAbsolute,
      outRelative,
      outHeading,
    );

    expect(source).toBe("telemetry");
    expect(outRelative.x).toBe(999);
  });
});
