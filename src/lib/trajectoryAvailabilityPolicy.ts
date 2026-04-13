import { computeBufferPlan, hasCoverageNearTime, type TrajectorySegment } from "@/lib/trajectoryEngine";
import { PLANET_MOONS } from "@/lib/textureConfig";
import type { OrbitLineData } from "@/lib/types";
import {
  buildContextualFetchBodyIds,
  getBodyFetchWindow,
  getCoverageToleranceMs,
  getMoonParentId,
} from "@/lib/trajectoryPolicy";

export interface TrajectoryCoverageDemand {
  date: string;
  fetchSpanDays: number;
  ids: string[];
}

export interface MoonOrbitPrefetchDemand {
  parentId: string;
  ids: string[];
}

interface CoverageDemandInput {
  bodyIds: string[];
  segmentsByBody: Record<string, TrajectorySegment[] | undefined>;
  timeMs: number;
  date: string;
  timeMultiplier: number;
}

interface BackgroundPaginationInput {
  bodyIds: string[];
  segmentsByBody: Record<string, TrajectorySegment[] | undefined>;
  timeMs: number;
  runtimeDate: string;
  timeMultiplier: number;
}

interface MoonOrbitPrefetchInput {
  parentIds: string[];
  orbitLines: Record<string, OrbitLineData | undefined>;
  minOrbitLinePoints: number;
}

function uniqueSortedIds(ids: Iterable<string>): string[] {
  return Array.from(new Set(ids)).sort();
}

function groupIdsByFetchSpan(ids: string[]): Map<number, string[]> {
  const grouped = new Map<number, string[]>();

  for (const id of ids) {
    const { fetchSpanDays } = getBodyFetchWindow(id);
    const existing = grouped.get(fetchSpanDays);
    if (existing) {
      existing.push(id);
    } else {
      grouped.set(fetchSpanDays, [id]);
    }
  }

  return grouped;
}

function resolveMoonParentId(bodyId: string | null | undefined): string | null {
  if (!bodyId) return null;
  if (PLANET_MOONS[bodyId]?.length) return bodyId;
  return getMoonParentId(bodyId) ?? null;
}

export function buildFetchBodyIds(activeIds: (string | null | undefined)[]): string[] {
  const [selectedBodyId, hoveredBodyId] = activeIds;
  return buildContextualFetchBodyIds({
    selectedBodyId: selectedBodyId ?? undefined,
    hoveredBodyId: hoveredBodyId ?? undefined,
  });
}

export function buildMoonOrbitPrefetchParentIds(
  selectedBodyId: string | null | undefined,
  selectedParentId: string | null | undefined,
  hoveredBodyId: string | null | undefined,
): string[] {
  const parentIds = new Set<string>();

  const selectedParent = resolveMoonParentId(selectedBodyId);
  if (selectedParent) parentIds.add(selectedParent);

  const hoveredParent = resolveMoonParentId(hoveredBodyId);
  if (hoveredParent) parentIds.add(hoveredParent);

  const explicitSelectedParent = resolveMoonParentId(selectedParentId);
  if (explicitSelectedParent) parentIds.add(explicitSelectedParent);

  return Array.from(parentIds);
}

export function buildCoverageDemands({
  bodyIds,
  segmentsByBody,
  timeMs,
  date,
  timeMultiplier,
}: CoverageDemandInput): TrajectoryCoverageDemand[] {
  const missingIds = bodyIds.filter((id) => {
    const segments = segmentsByBody[id] ?? [];
    const toleranceMs = getCoverageToleranceMs(id, timeMultiplier);
    return !hasCoverageNearTime(segments, timeMs, toleranceMs);
  });

  const grouped = groupIdsByFetchSpan(missingIds);
  return Array.from(grouped.entries()).map(([fetchSpanDays, ids]) => ({
    date,
    fetchSpanDays,
    ids: uniqueSortedIds(ids),
  }));
}

export function buildBackgroundPaginationDemands({
  bodyIds,
  segmentsByBody,
  timeMs,
  runtimeDate,
  timeMultiplier,
}: BackgroundPaginationInput): TrajectoryCoverageDemand[] {
  const groupedFetches = new Map<string, { date: string; fetchSpanDays: number; ids: Set<string> }>();

  for (const id of bodyIds) {
    const segments = segmentsByBody[id] ?? [];
    const { fetchSpanDays, thresholdDays } = getBodyFetchWindow(id);
    const plan = computeBufferPlan({
      segments,
      timeMs,
      thresholdDays,
      fetchSpanDays,
      timeMultiplier,
      currentDate: runtimeDate,
    });

    for (const date of plan.fetchDates) {
      if (!date) continue;
      const groupKey = `${date}|${fetchSpanDays}`;
      const existing = groupedFetches.get(groupKey);
      if (existing) {
        existing.ids.add(id);
      } else {
        groupedFetches.set(groupKey, {
          date,
          fetchSpanDays,
          ids: new Set([id]),
        });
      }
    }
  }

  return Array.from(groupedFetches.values()).map(({ date, fetchSpanDays, ids }) => ({
    date,
    fetchSpanDays,
    ids: uniqueSortedIds(ids),
  }));
}

export function buildMoonOrbitPrefetchDemands({
  parentIds,
  orbitLines,
  minOrbitLinePoints,
}: MoonOrbitPrefetchInput): MoonOrbitPrefetchDemand[] {
  const demands: MoonOrbitPrefetchDemand[] = [];

  for (const parentId of parentIds) {
    const moonIds = PLANET_MOONS[parentId] ?? [];
    if (moonIds.length === 0) continue;

    const missingMoonIds = moonIds.filter((moonId) => {
      const orbitLine = orbitLines[moonId];
      return !orbitLine || orbitLine.points.length < minOrbitLinePoints;
    });

    if (missingMoonIds.length === 0) continue;
    demands.push({
      parentId,
      ids: uniqueSortedIds(missingMoonIds),
    });
  }

  return demands;
}
