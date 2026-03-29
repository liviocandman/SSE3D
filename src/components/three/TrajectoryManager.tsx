"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSolarStore } from "@/store/solarStore";
import { useShallow } from "zustand/react/shallow";
import { PLANET_MOONS } from "@/lib/textureConfig";
import { computeBufferPlan, hasCoverageNearTime } from "@/lib/trajectoryEngine";
import { useTrajectoryWorker } from "@/hooks/useTrajectoryWorker";

const COVERAGE_TOLERANCE_MS = 48 * 60 * 60 * 1000; // Increased to 48h to avoid flickering at segment boundaries
const CORE_PLANET_IDS = [
  "199",
  "299",
  "399",
  "499",
  "599",
  "699",
  "799",
  "899",
];

export function getDynamicBufferParams() {
  // 30 days of data with a 15-day prefetch threshold.
  return { fetchSpanDays: 30, thresholdDays: 15 };
}

export function buildFetchBodyIds(selectedBodyId?: string): string[] {
  const ids = [...CORE_PLANET_IDS];
  if (selectedBodyId && !ids.includes(selectedBodyId)) {
    ids.push(selectedBodyId);
  }
  if (selectedBodyId && PLANET_MOONS[selectedBodyId]) {
    PLANET_MOONS[selectedBodyId].forEach((moonId) => {
      if (!ids.includes(moonId)) ids.push(moonId);
    });
  }
  return ids;
}

export function TrajectoryManager() {
  const {
    currentTime,
    currentDate,
    timeMultiplier,
    selectedPlanet,
    masterTrajectorySegments,
    appendTrajectoryData,
  } = useSolarStore(
    useShallow((s) => ({
      currentTime: s.currentTime,
      currentDate: s.currentDate,
      timeMultiplier: s.timeMultiplier,
      selectedPlanet: s.selectedPlanet,
      masterTrajectorySegments: s.masterTrajectorySegments,
      appendTrajectoryData: s.appendTrajectoryData,
      clearTrajectoryBuffer: s.clearTrajectoryBuffer,
    })),
  );

  const { fetchTrajectory } = useTrajectoryWorker();
  const loadingRef = useRef<Set<string>>(new Set());
  const frameCountRef = useRef(0);
  const lastFetchRef = useRef<string | null>(null);
  const jumpAbortControllerRef = useRef<AbortController | null>(null);

  const fetchBlock = useCallback(
    async (date: string, spanDays: number, specificIds?: string[], signal?: AbortSignal) => {
      const liveSelectedBodyId = useSolarStore.getState().selectedPlanet?.bodyId;
      const ids =
        specificIds && specificIds.length > 0
          ? specificIds
          : buildFetchBodyIds(liveSelectedBodyId);

      const blockCacheKey = `block_${date}_${spanDays}_${ids.join(",")}`;
      if (loadingRef.current.has(blockCacheKey)) {
        return;
      }

      loadingRef.current.add(blockCacheKey);
      console.log(
        `[TrajectoryManager] Worker-powered Loading block starting at ${date} (span: ${spanDays}d) for ${ids.length} bodies...`,
      );

      try {
        const data = await fetchTrajectory(date, spanDays, ids, signal);
        appendTrajectoryData(data);
        console.log(
          `[TrajectoryManager] Block starting at ${date} processed by worker and appended successfully.`,
        );
      } catch (err: unknown) {
        const error = err as Error;
        if (error.message === 'AbortError') {
          console.log(`[TrajectoryManager] Fetch aborted for ${date}`);
        } else {
          console.error(
            `[TrajectoryManager] Failed to fetch block at ${date}:`,
            err,
          );
        }
      } finally {
        setTimeout(() => loadingRef.current.delete(blockCacheKey), 5000);
      }
    },
    [appendTrajectoryData, fetchTrajectory],
  );

  // 1. Initial / Jump Fetch - triggered ONLY when currentDate changes significantly
  useEffect(() => {
    // Only trigger if we haven't fetched this base date recently
    if (lastFetchRef.current === currentDate) return;

    // DEBOUNCE: Wait 300ms before firing a "jump" fetch to handle rapid scrubbing
    const debounceTimeout = setTimeout(() => {
      const bodyIds = buildFetchBodyIds(selectedPlanet?.bodyId);
      const timeMs = currentTime.getTime();
      const { fetchSpanDays } = getDynamicBufferParams();

      const missingIds = bodyIds.filter((id) => {
        const segments = masterTrajectorySegments[id] || [];
        return !hasCoverageNearTime(segments, timeMs, COVERAGE_TOLERANCE_MS);
      });

      if (missingIds.length > 0) {
        const cacheKey = `jump_${currentDate}_${fetchSpanDays}_${missingIds.join(",")}`;

        if (!loadingRef.current.has(cacheKey)) {
          // Cancel previous jump request if it's still in flight
          if (jumpAbortControllerRef.current) {
            jumpAbortControllerRef.current.abort();
          }
          jumpAbortControllerRef.current = new AbortController();

          loadingRef.current.add(cacheKey);
          
          console.log(
            `[TrajectoryManager] Fetching missing data for ${missingIds.length} bodies at ${currentDate}`,
          );
          fetchBlock(currentDate, fetchSpanDays, missingIds, jumpAbortControllerRef.current.signal);
          lastFetchRef.current = currentDate;

          setTimeout(() => loadingRef.current.delete(cacheKey), 5000);
        }
      }
    }, 300);

    return () => {
      clearTimeout(debounceTimeout);
      // Optional: don't abort on every minor scrub if we want to keep some background noise, 
      // but for "jump" (main data), aborting is safer to prioritize the latest target.
    };
  }, [
    currentDate,
    currentTime,
    selectedPlanet?.bodyId,
    masterTrajectorySegments,
    fetchBlock,
  ]);

  // 2. Background pagination driven by segment coverage
  useFrame(() => {
    frameCountRef.current++;
    // Check every 60 frames (approx 1s) to reduce CPU overhead
    if (frameCountRef.current % 60 !== 0) return;

    const timeMs = currentTime.getTime();
    const { fetchSpanDays, thresholdDays } = getDynamicBufferParams();

    const liveSelectedBodyId = useSolarStore.getState().selectedPlanet?.bodyId;
    const bodyIds = buildFetchBodyIds(liveSelectedBodyId);

    const fetchDates = new Set<string>();
    const missingIdsForDate: Record<string, Set<string>> = {};

    for (const id of bodyIds) {
      const segments = masterTrajectorySegments[id] || [];
      const plan = computeBufferPlan({
        segments,
        timeMs,
        thresholdDays,
        fetchSpanDays,
        timeMultiplier,
        currentDate,
      });

      // We DON'T pause anymore. We let the simulation "ghost" using fallbacks
      // while we fetch in the background. This is much smoother for the user.

      for (const date of plan.fetchDates) {
        fetchDates.add(date);
        if (!missingIdsForDate[date]) missingIdsForDate[date] = new Set();
        missingIdsForDate[date].add(id);
      }
    }

    for (const date of fetchDates) {
      const idsToFetch = Array.from(missingIdsForDate[date]);
      const preciseCacheKey = `page_${date}_${fetchSpanDays}_${idsToFetch.join(",")}`;

      if (!loadingRef.current.has(preciseCacheKey)) {
        loadingRef.current.add(preciseCacheKey);
        fetchBlock(date, fetchSpanDays, idsToFetch);

        setTimeout(() => loadingRef.current.delete(preciseCacheKey), 10000);
      }
    }
  });

  return null;
}
