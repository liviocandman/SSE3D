import { describe, expect, it } from "vitest";
import { buildTrajectorySegment, type TrajectorySegment } from "@/lib/trajectoryEngine";
import type { OrbitLineData } from "@/lib/types";
import {
  buildBackgroundPaginationDemands,
  buildCoverageDemands,
  buildFetchBodyIds,
  buildMoonOrbitPrefetchDemands,
  buildMoonOrbitPrefetchParentIds,
} from "@/lib/trajectoryAvailabilityPolicy";

function createSegment(startIso: string, endIso: string): TrajectorySegment {
  const segment = buildTrajectorySegment([
    {
      timestamp: startIso,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    },
    {
      timestamp: endIso,
      position: { x: 1, y: 1, z: 1 },
      velocity: { x: 0, y: 0, z: 0 },
    },
  ]);

  if (!segment) {
    throw new Error("Expected segment to be created");
  }

  return segment;
}

function createOrbitLine(pointCount: number): OrbitLineData {
  return {
    points: Array.from({ length: pointCount }, (_, index) => ({
      x: index,
      y: index,
      z: index,
      timestamp: `2026-04-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    })),
    isClosed: true,
    profile: "auto",
    algorithmVersion: "test",
    sourceWindowStart: "2026-04-01T00:00:00Z",
    sourceWindowEnd: "2026-04-30T00:00:00Z",
    inputPointCount: pointCount,
    outputPointCount: pointCount,
    qualityFlags: [],
  };
}

describe("trajectoryAvailabilityPolicy", () => {
  it("includes core planets by default", () => {
    const ids = buildFetchBodyIds([]);
    expect(ids).toEqual([
      "199",
      "299",
      "399",
      "499",
      "599",
      "699",
      "799",
      "899",
    ]);
  });

  it("resolves selected moon and hovered planet to moon-system parents", () => {
    const parentIds = buildMoonOrbitPrefetchParentIds("501", "599", "699");
    expect(parentIds).toEqual(["599", "699"]);
  });

  it("groups missing bodies by fetch span", () => {
    const demands = buildCoverageDemands({
      bodyIds: ["399", "501"],
      segmentsByBody: {
        "399": [createSegment("2026-04-01T00:00:00Z", "2026-05-31T00:00:00Z")],
        "501": [],
      },
      timeMs: Date.parse("2026-04-15T00:00:00Z"),
      date: "2026-04-15",
      timeMultiplier: 1,
    });

    expect(demands).toEqual([
      {
        date: "2026-04-15",
        fetchSpanDays: 7,
        ids: ["501"],
      },
    ]);
  });

  it("emits background pagination demands near coverage edge", () => {
    const demands = buildBackgroundPaginationDemands({
      bodyIds: ["399"],
      segmentsByBody: {
        "399": [createSegment("2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z")],
      },
      timeMs: Date.parse("2026-04-25T12:00:00Z"),
      runtimeDate: "2026-04-25",
      timeMultiplier: 1,
    });

    expect(demands).toEqual([
      {
        date: "2026-05-02",
        fetchSpanDays: 45,
        ids: ["399"],
      },
    ]);
  });

  it("only requests moon orbit lines that are still missing", () => {
    const demands = buildMoonOrbitPrefetchDemands({
      parentIds: ["599"],
      orbitLines: {
        "501": createOrbitLine(3),
        "502": createOrbitLine(1),
      },
      minOrbitLinePoints: 2,
    });

    expect(demands).toEqual([
      {
        parentId: "599",
        ids: ["502", "503", "504"],
      },
    ]);
  });
});
