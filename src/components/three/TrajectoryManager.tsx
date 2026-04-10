"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSolarStore } from "@/store/solarStore";
import { useShallow } from "zustand/react/shallow";
import { computeBufferPlan, hasCoverageNearTime } from "@/lib/trajectoryEngine";
import { useTrajectoryWorker } from "@/hooks/useTrajectoryWorker";
import { clockRuntime } from "@/lib/time/clockRuntime";
import { PLANET_MOONS } from "@/lib/textureConfig";
import {
  buildContextualFetchBodyIds,
  buildTrajectoryRequestKey,
  getBodyFetchWindow,
  getCoverageToleranceMs,
} from "@/lib/trajectoryPolicy";

import { useQualityTier } from "@/contexts/QualityTierContext";

const JUMP_DEBOUNCE_MS = 450;
const TARGET_CHANGE_DEBOUNCE_MS = 250;
const BACKGROUND_PAGINATION_EVERY_FRAMES = 300;
const FETCH_LOCK_TTL_MS = 5000;
const FETCH_COOLDOWN_MS = 15_000;
const MOON_ORBIT_PREFETCH_DEBOUNCE_MS = 250;
const MOON_ORBIT_PREFETCH_COOLDOWN_MS = 30_000;
const MIN_ORBIT_LINE_POINTS = 2;

function toDateStringUTC(ms: number): string {
  return new Date(ms).toISOString().split("T")[0];
}

export function buildFetchBodyIds(activeIds: (string | null | undefined)[]): string[] {
  const [selectedBodyId, hoveredBodyId] = activeIds;
  return buildContextualFetchBodyIds({
    selectedBodyId: selectedBodyId ?? undefined,
    hoveredBodyId: hoveredBodyId ?? undefined,
  });
}

function resolveMoonParentId(bodyId: string | null | undefined): string | null {
  if (!bodyId) return null;
  if (PLANET_MOONS[bodyId]?.length) return bodyId;

  for (const [parentId, moonIds] of Object.entries(PLANET_MOONS)) {
    if (moonIds.includes(bodyId)) {
      return parentId;
    }
  }

  return null;
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

function debugTrajectoryLog(message: string): void {
  if (process.env.NODE_ENV !== "production") {
    console.info(message);
  }
}

export function TrajectoryManager() {
  const { tier } = useQualityTier();
  const {
    currentDate,
    timeMultiplier,
    selectedPlanet,
    hoveredPlanetId,
    appendTrajectoryData,
    appendFullOrbits,
  } = useSolarStore(
    useShallow((s) => ({
      currentDate: s.currentDate,
      timeMultiplier: s.timeMultiplier,
      selectedPlanet: s.selectedPlanet,
      hoveredPlanetId: s.hoveredPlanetId,
      appendTrajectoryData: s.appendTrajectoryData,
      appendFullOrbits: s.appendFullOrbits,
    })),
  );

  const { fetchTrajectory } = useTrajectoryWorker();
  const loadingRef = useRef<Set<string>>(new Set());
  const lastFetchAtRef = useRef<Map<string, number>>(new Map());
  const activeTimeouts = useRef<Set<NodeJS.Timeout>>(new Set());
  const frameCountRef = useRef(0);
  const lastFetchRef = useRef<string | null>(null);
  const jumpAbortControllerRef = useRef<AbortController | null>(null);
  const moonOrbitPrefetchAtRef = useRef<Map<string, number>>(new Map());

  // Cleanup on unmount or major jumps
  useEffect(() => {
    const timeouts = activeTimeouts.current;
    const loading = loadingRef.current;
    const lastFetchAt = lastFetchAtRef.current;
    const moonOrbitPrefetchAt = moonOrbitPrefetchAtRef.current;
    return () => {
      // Clear all pending lock removals
      timeouts.forEach(clearTimeout);
      timeouts.clear();
      loading.clear();
      lastFetchAt.clear();
      moonOrbitPrefetchAt.clear();
      
      if (jumpAbortControllerRef.current) {
        jumpAbortControllerRef.current.abort();
      }
    };
  }, []);

  const lockRequestKey = useCallback((requestKey: string) => {
    const now = Date.now();
    if (loadingRef.current.has(requestKey)) {
      return false;
    }

    const lastFetchAt = lastFetchAtRef.current.get(requestKey);
    if (lastFetchAt !== undefined && now - lastFetchAt < FETCH_COOLDOWN_MS) {
      return false;
    }

    loadingRef.current.add(requestKey);
    lastFetchAtRef.current.set(requestKey, now);
    return true;
  }, []);

  const unlockRequestKey = useCallback((requestKey: string) => {
    const timerId = setTimeout(() => {
      loadingRef.current.delete(requestKey);
      activeTimeouts.current.delete(timerId);
    }, FETCH_LOCK_TTL_MS);

    activeTimeouts.current.add(timerId);
  }, []);

  const groupByFetchSpan = useCallback((ids: string[]) => {
    const grouped = new Map<number, string[]>();
    for (const id of ids) {
      const { fetchSpanDays } = getBodyFetchWindow(id);
      const list = grouped.get(fetchSpanDays);
      if (list) {
        list.push(id);
      } else {
        grouped.set(fetchSpanDays, [id]);
      }
    }
    return grouped;
  }, []);

  const fetchBlock = useCallback(
    async (
      date: string,
      spanDays: number,
      specificIds?: string[],
      signal?: AbortSignal
    ): Promise<void> => {
      const state = useSolarStore.getState();
      const ids =
        specificIds && specificIds.length > 0
          ? specificIds
          : buildFetchBodyIds([state.selectedPlanet?.bodyId, state.hoveredPlanetId]);

      const requestKey = buildTrajectoryRequestKey(date, spanDays, ids, tier);
      if (!lockRequestKey(requestKey)) {
        return;
      }
      debugTrajectoryLog(
        `[TrajectoryManager] Loading block at ${date} (span: ${spanDays}d) for ${ids.length} bodies.`,
      );

      try {
        const data = await fetchTrajectory(date, spanDays, ids, tier, signal);
        appendTrajectoryData(data);
        debugTrajectoryLog(`[TrajectoryManager] Block at ${date} appended.`);
      } catch (err: unknown) {
        const error = err as Error;
        if (error.message === 'AbortError') {
          debugTrajectoryLog(`[TrajectoryManager] Fetch aborted for ${date}`);
        } else {
          console.error(`[TrajectoryManager] Failed to fetch block at ${date}:`, err);
        }
      } finally {
        unlockRequestKey(requestKey);
      }
    },
    [appendTrajectoryData, fetchTrajectory, lockRequestKey, tier, unlockRequestKey],
  );

  // 1A. Time Travel Fetch (DEBOUNCED)
  useEffect(() => {
    if (lastFetchRef.current === currentDate) return;

    const debounceTimeout = setTimeout(() => {
      const bodyIds = buildFetchBodyIds([selectedPlanet?.bodyId, hoveredPlanetId]);
      const state = useSolarStore.getState();
      const timeMs = clockRuntime.getTimeMs();
      const segmentsByBody = state.masterTrajectorySegments;

      const missingIds = bodyIds.filter((id) => {
        const segments = segmentsByBody[id] || [];
        const toleranceMs = getCoverageToleranceMs(id, timeMultiplier);
        return !hasCoverageNearTime(segments, timeMs, toleranceMs);
      });

      if (missingIds.length > 0) {
        if (jumpAbortControllerRef.current) {
          jumpAbortControllerRef.current.abort();
        }
        jumpAbortControllerRef.current = new AbortController();

        const missingIdsBySpan = groupByFetchSpan(missingIds);
        for (const [fetchSpanDays, idsForSpan] of missingIdsBySpan) {
          fetchBlock(currentDate, fetchSpanDays, idsForSpan, jumpAbortControllerRef.current.signal);
        }
      }
      lastFetchRef.current = currentDate;
    }, JUMP_DEBOUNCE_MS);

    return () => clearTimeout(debounceTimeout);
  }, [currentDate, fetchBlock, groupByFetchSpan, hoveredPlanetId, selectedPlanet?.bodyId, timeMultiplier]);

  // 1B. Target-change fetch
  useEffect(() => {
    const debounceTimeout = setTimeout(() => {
      const targetIds = buildFetchBodyIds([selectedPlanet?.bodyId, hoveredPlanetId]);
      const state = useSolarStore.getState();
      const timeMs = clockRuntime.getTimeMs();
      const runtimeDate = toDateStringUTC(timeMs);
      const segmentsByBody = state.masterTrajectorySegments;

      const missingIds = targetIds.filter((id) => {
        const segments = segmentsByBody[id] || [];
        const toleranceMs = getCoverageToleranceMs(id, timeMultiplier);
        return !hasCoverageNearTime(segments, timeMs, toleranceMs);
      });

      if (missingIds.length > 0) {
        const missingIdsBySpan = groupByFetchSpan(missingIds);
        for (const [fetchSpanDays, idsForSpan] of missingIdsBySpan) {
          fetchBlock(runtimeDate, fetchSpanDays, idsForSpan);
        }
      }
    }, TARGET_CHANGE_DEBOUNCE_MS);

    return () => clearTimeout(debounceTimeout);
  }, [currentDate, fetchBlock, groupByFetchSpan, hoveredPlanetId, selectedPlanet?.bodyId, timeMultiplier]);

  // 1C. Prefetch orbit lines for moon systems from hovered/selected planet context.
  useEffect(() => {
    const controller = new AbortController();
    const debounceTimeout = setTimeout(() => {
      const parentIds = buildMoonOrbitPrefetchParentIds(
        selectedPlanet?.bodyId,
        selectedPlanet?.parentId ?? null,
        hoveredPlanetId,
      );
      if (parentIds.length === 0) return;

      const state = useSolarStore.getState();
      const now = Date.now();

      for (const parentId of parentIds) {
        const moonIds = PLANET_MOONS[parentId] ?? [];
        if (moonIds.length === 0) continue;

        const missingMoonIds = moonIds.filter((moonId) => {
          const orbitLine = state.orbitLines[moonId];
          return !orbitLine || orbitLine.points.length < MIN_ORBIT_LINE_POINTS;
        });
        if (missingMoonIds.length === 0) continue;

        const prefetchKey = `${parentId}:${missingMoonIds.slice().sort().join(",")}`;
        const lastPrefetchAt = moonOrbitPrefetchAtRef.current.get(prefetchKey);
        if (lastPrefetchAt !== undefined && now - lastPrefetchAt < MOON_ORBIT_PREFETCH_COOLDOWN_MS) {
          continue;
        }

        moonOrbitPrefetchAtRef.current.set(prefetchKey, now);

        void (async () => {
          try {
            const response = await fetch(
              `/api/ephemeris?ids=${missingMoonIds.join(",")}&fullOrbit=true&orbitReady=true&orbitLineOnly=true`,
              { signal: controller.signal }
            );
            if (!response.ok) return;
            const payload = await response.json();
            if (Array.isArray(payload?.data)) {
              appendFullOrbits(payload.data);
            }
          } catch (error) {
            if ((error as Error).name === "AbortError") return;
            debugTrajectoryLog(`[TrajectoryManager] Moon orbit prefetch failed for parent ${parentId}.`);
          }
        })();
      }
    }, MOON_ORBIT_PREFETCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(debounceTimeout);
    };
  }, [appendFullOrbits, hoveredPlanetId, selectedPlanet?.bodyId, selectedPlanet?.parentId]);

  // 2. Background pagination driven by segment coverage
  useFrame(() => {
    frameCountRef.current++;
    if (frameCountRef.current % BACKGROUND_PAGINATION_EVERY_FRAMES !== 0) return;

    const state = useSolarStore.getState();
    const timeMs = clockRuntime.getTimeMs();
    const runtimeDate = toDateStringUTC(timeMs);

    const segmentsByBody = state.masterTrajectorySegments;
    const bodyIds = buildFetchBodyIds([state.selectedPlanet?.bodyId, state.hoveredPlanetId]);

    const groupedFetches = new Map<string, { date: string; fetchSpanDays: number; ids: Set<string> }>();

    for (const id of bodyIds) {
      const segments = segmentsByBody[id] || [];
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

    for (const { date, fetchSpanDays, ids } of groupedFetches.values()) {
      fetchBlock(date, fetchSpanDays, Array.from(ids));
    }
  });

  return null;
}
