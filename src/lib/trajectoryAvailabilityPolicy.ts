import { findSegmentIndexForTime, hasCoverageNearTime, type TrajectorySegment } from "@/lib/trajectoryEngine";
import { TRAJECTORY_DAY_MS as DAY_MS, trajectoryRequestDate } from "./trajectoryRequestWindow";
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

function groupDemands(demands: TrajectoryCoverageDemand[]): TrajectoryCoverageDemand[] {
  const groups = new Map<string, TrajectoryCoverageDemand>();
  for (const demand of demands) {
    const key = `${demand.date}|${demand.fetchSpanDays}`;
    const group = groups.get(key);
    if (group) group.ids.push(...demand.ids);
    else groups.set(key, { ...demand, ids: [...demand.ids] });
  }
  return Array.from(groups.values(), (group) => ({ ...group, ids: uniqueSortedIds(group.ids) }));
}

function coverageDemand(bodyId: string, date: string): TrajectoryCoverageDemand {
  const { fetchSpanDays } = getBodyFetchWindow(bodyId);
  // Keep useful samples on both sides for forward/reverse playback while the
  // response is in flight. The backend anchors planets at the END of a window.
  const startMs = Date.parse(`${date}T00:00:00Z`) - Math.floor(fetchSpanDays / 2) * DAY_MS;
  return { date: trajectoryRequestDate(bodyId, startMs, fetchSpanDays), fetchSpanDays, ids: [bodyId] };
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

  return groupDemands(missingIds.map((id) => coverageDemand(id, date)));
}

export function buildBackgroundPaginationDemands({
  bodyIds,
  segmentsByBody,
  timeMs,
  runtimeDate,
  timeMultiplier,
}: BackgroundPaginationInput): TrajectoryCoverageDemand[] {
  const demands: TrajectoryCoverageDemand[] = [];
  for (const id of bodyIds) {
    const segments = segmentsByBody[id] ?? [];
    const containingIndex = findSegmentIndexForTime(segments, timeMs);
    if (containingIndex === -1) {
      demands.push(coverageDemand(id, runtimeDate));
      continue;
    }
    const segment = segments[containingIndex];
    const { fetchSpanDays, thresholdDays } = getBodyFetchWindow(id);
    // Adjacent windows overlap at the boundary; no artificial one-day gaps.
    if (timeMultiplier >= 0 && timeMs > segment.endTimeMs - thresholdDays * DAY_MS) {
      const startMs = Math.floor(segment.endTimeMs / DAY_MS) * DAY_MS;
      demands.push({ date: trajectoryRequestDate(id, startMs, fetchSpanDays), fetchSpanDays, ids: [id] });
    }
    if (timeMultiplier <= 0 && timeMs < segment.startTimeMs + thresholdDays * DAY_MS) {
      const startMs = Math.ceil(segment.startTimeMs / DAY_MS) * DAY_MS - fetchSpanDays * DAY_MS;
      demands.push({ date: trajectoryRequestDate(id, startMs, fetchSpanDays), fetchSpanDays, ids: [id] });
    }
  }
  return groupDemands(demands);
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
