"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSolarStore } from "@/store/solarStore";
import { useShallow } from "zustand/react/shallow";
import { clockRuntime } from "@/lib/time/clockRuntime";
import { useTrajectoryClient } from "@/hooks/useTrajectoryClient";
import { useQualityTier } from "@/contexts/QualityTierContext";
import {
  buildBackgroundPaginationDemands,
  buildCoverageDemands,
  buildFetchBodyIds,
  buildMoonOrbitPrefetchDemands,
  buildMoonOrbitPrefetchParentIds,
} from "@/lib/trajectoryAvailabilityPolicy";

const JUMP_DEBOUNCE_MS = 450;
const TARGET_CHANGE_DEBOUNCE_MS = 250;
const BACKGROUND_PAGINATION_EVERY_FRAMES = 300;
const MOON_ORBIT_PREFETCH_DEBOUNCE_MS = 250;
const MOON_ORBIT_PREFETCH_MAX_RETRIES = 3;
const MOON_ORBIT_PREFETCH_RETRY_BASE_MS = 750;
const MIN_ORBIT_LINE_POINTS = 2;

function toDateStringUTC(ms: number): string {
  return new Date(ms).toISOString().split("T")[0];
}

function debugTrajectoryLog(message: string): void {
  if (process.env.NODE_ENV !== "production") {
    console.info(message);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

  const { requestTrajectoryBlock, requestOrbitLines } = useTrajectoryClient();
  const frameCountRef = useRef(0);
  const lastFetchRef = useRef<string | null>(null);
  const jumpAbortControllerRef = useRef<AbortController | null>(null);

  // Cleanup on unmount or major jumps
  useEffect(() => {
    return () => {
      if (jumpAbortControllerRef.current) {
        jumpAbortControllerRef.current.abort();
      }
    };
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

      debugTrajectoryLog(
        `[TrajectoryManager] Loading block at ${date} (span: ${spanDays}d) for ${ids.length} bodies.`,
      );

      try {
        const data = await requestTrajectoryBlock({ date, spanDays, ids, tier, signal });
        if (data.length > 0) {
          appendTrajectoryData(data);
          debugTrajectoryLog(`[TrajectoryManager] Block at ${date} appended.`);
        }
      } catch (err: unknown) {
        const error = err as Error;
        if (error.message === 'AbortError') {
          debugTrajectoryLog(`[TrajectoryManager] Fetch aborted for ${date}`);
        } else {
          console.error(`[TrajectoryManager] Failed to fetch block at ${date}:`, err);
        }
      }
    },
    [appendTrajectoryData, requestTrajectoryBlock, tier],
  );

  // 1A. Time Travel Fetch (DEBOUNCED)
  useEffect(() => {
    if (lastFetchRef.current === currentDate) return;

    const debounceTimeout = setTimeout(() => {
      const state = useSolarStore.getState();
      const timeMs = clockRuntime.getTimeMs();
      const demands = buildCoverageDemands({
        bodyIds: buildFetchBodyIds([selectedPlanet?.bodyId, hoveredPlanetId]),
        segmentsByBody: state.masterTrajectorySegments,
        timeMs,
        date: currentDate,
        timeMultiplier,
      });

      if (demands.length > 0) {
        if (jumpAbortControllerRef.current) {
          jumpAbortControllerRef.current.abort();
        }
        jumpAbortControllerRef.current = new AbortController();

        for (const demand of demands) {
          void fetchBlock(
            demand.date,
            demand.fetchSpanDays,
            demand.ids,
            jumpAbortControllerRef.current.signal,
          );
        }
      }
      lastFetchRef.current = currentDate;
    }, JUMP_DEBOUNCE_MS);

    return () => clearTimeout(debounceTimeout);
  }, [currentDate, fetchBlock, hoveredPlanetId, selectedPlanet?.bodyId, timeMultiplier]);

  // 1B. Target-change fetch
  useEffect(() => {
    const debounceTimeout = setTimeout(() => {
      const state = useSolarStore.getState();
      const timeMs = clockRuntime.getTimeMs();
      const runtimeDate = toDateStringUTC(timeMs);

      const demands = buildCoverageDemands({
        bodyIds: buildFetchBodyIds([selectedPlanet?.bodyId, hoveredPlanetId]),
        segmentsByBody: state.masterTrajectorySegments,
        timeMs,
        date: runtimeDate,
        timeMultiplier,
      });

      for (const demand of demands) {
        void fetchBlock(demand.date, demand.fetchSpanDays, demand.ids);
      }
    }, TARGET_CHANGE_DEBOUNCE_MS);

    return () => clearTimeout(debounceTimeout);
  }, [currentDate, fetchBlock, hoveredPlanetId, selectedPlanet?.bodyId, timeMultiplier]);

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
      const demands = buildMoonOrbitPrefetchDemands({
        parentIds,
        orbitLines: state.orbitLines,
        minOrbitLinePoints: MIN_ORBIT_LINE_POINTS,
      });

      for (const demand of demands) {
        void (async () => {
          for (let attempt = 0; attempt < MOON_ORBIT_PREFETCH_MAX_RETRIES; attempt += 1) {
            try {
              const data = await requestOrbitLines(demand.ids, controller.signal);
              if (data.length > 0) {
                appendFullOrbits(data);
              }
              return;
            } catch (error) {
              if ((error as Error).message === "AbortError" || controller.signal.aborted) {
                return;
              }

              if (attempt < MOON_ORBIT_PREFETCH_MAX_RETRIES - 1) {
                await delay(MOON_ORBIT_PREFETCH_RETRY_BASE_MS * (attempt + 1));
                continue;
              }

              debugTrajectoryLog(
                `[TrajectoryManager] Moon orbit prefetch failed for parent ${demand.parentId}.`,
              );
            }
          }
        })();
      }
    }, MOON_ORBIT_PREFETCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(debounceTimeout);
    };
  }, [appendFullOrbits, hoveredPlanetId, requestOrbitLines, selectedPlanet?.bodyId, selectedPlanet?.parentId]);

  // 2. Background pagination driven by segment coverage
  useFrame(() => {
    frameCountRef.current++;
    if (frameCountRef.current % BACKGROUND_PAGINATION_EVERY_FRAMES !== 0) return;

    const state = useSolarStore.getState();
    const timeMs = clockRuntime.getTimeMs();
    const runtimeDate = toDateStringUTC(timeMs);

    const demands = buildBackgroundPaginationDemands({
      bodyIds: buildFetchBodyIds([state.selectedPlanet?.bodyId, state.hoveredPlanetId]),
      segmentsByBody: state.masterTrajectorySegments,
      timeMs,
      runtimeDate,
      timeMultiplier,
    });

    for (const demand of demands) {
      void fetchBlock(demand.date, demand.fetchSpanDays, demand.ids);
    }
  });

  return null;
}
