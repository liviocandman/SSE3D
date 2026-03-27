"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSolarStore } from "@/store/solarStore";
import { useShallow } from "zustand/react/shallow";
import { PLANET_MOONS } from "@/lib/textureConfig";
import { computeBufferPlan, hasCoverageNearTime } from "@/lib/trajectoryEngine";

const COVERAGE_TOLERANCE_MS = 24 * 60 * 60 * 1000;
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
    isPlaying,
    selectedPlanet,
    masterTrajectorySegments,
    appendTrajectoryData,
    clearTrajectoryBuffer,
    setIsPlaying,
  } = useSolarStore(
    useShallow((s) => ({
      currentTime: s.currentTime,
      currentDate: s.currentDate,
      timeMultiplier: s.timeMultiplier,
      isPlaying: s.isPlaying,
      selectedPlanet: s.selectedPlanet,
      masterTrajectorySegments: s.masterTrajectorySegments,
      appendTrajectoryData: s.appendTrajectoryData,
      clearTrajectoryBuffer: s.clearTrajectoryBuffer,
      setIsPlaying: s.setIsPlaying,
    })),
  );

  const loadingRef = useRef<Set<string>>(new Set());
  const frameCountRef = useRef(0);

  const fetchBlock = useCallback(
    async (date: string, spanDays: number, specificIds?: string[]) => {
      const liveSelectedBodyId = useSolarStore.getState().selectedPlanet?.bodyId;
      const ids =
        specificIds && specificIds.length > 0
          ? specificIds
          : buildFetchBodyIds(liveSelectedBodyId);

      // Fallback block key to prevent exact duplicate fetches within this function itself
      const blockCacheKey = `block_${date}_${spanDays}_${ids.join(",")}`;
      if (loadingRef.current.has(blockCacheKey)) {
        return;
      }

      loadingRef.current.add(blockCacheKey);
      console.log(
        `[TrajectoryManager] Ghost Loading block starting at ${date} (span: ${spanDays}d) for ${ids.length} bodies...`,
      );

      try {
        const params = new URLSearchParams({
          date,
          spanDays: spanDays.toString(),
          ids: ids.join(","),
        });

        const response = await fetch(`/api/ephemeris?${params.toString()}`);
        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

        const payload = await response.json();
        appendTrajectoryData(payload.data);
        console.log(
          `[TrajectoryManager] Block starting at ${date} appended successfully.`,
        );
      } catch (err) {
        console.error(
          `[TrajectoryManager] Failed to fetch block at ${date}:`,
          err,
        );
      } finally {
        setTimeout(() => loadingRef.current.delete(blockCacheKey), 5000);
      }
    },
    [appendTrajectoryData],
  );

  // 1. Initial / Jump Fetch
  useEffect(() => {
    const bodyIds = buildFetchBodyIds(selectedPlanet?.bodyId);
    const timeMs = currentTime.getTime();
    const { fetchSpanDays } = getDynamicBufferParams();

    // Identify exactly which bodies lack coverage for the current time
    const missingIds = bodyIds.filter((id) => {
      const segments = masterTrajectorySegments[id] || [];
      return !hasCoverageNearTime(segments, timeMs, COVERAGE_TOLERANCE_MS);
    });

    if (missingIds.length > 0) {
      const cacheKey = `jump_${currentDate}_${fetchSpanDays}_${missingIds.join(",")}`;

      if (!loadingRef.current.has(cacheKey)) {
        // If Earth is missing, we consider it a true "jump" completely out of bounds
        if (missingIds.includes("399")) {
          console.log(
            `[TrajectoryManager] Out-of-bounds jump detected. Clearing buffer.`,
          );
          clearTrajectoryBuffer();
        }

        console.log(
          `[TrajectoryManager] Fetching missing data for ${missingIds.length} bodies at ${currentDate}`,
        );
        fetchBlock(currentDate, fetchSpanDays, missingIds);

        loadingRef.current.add(cacheKey);
        setTimeout(() => loadingRef.current.delete(cacheKey), 5000);
      }
    }
  }, [
    currentDate,
    currentTime,
    selectedPlanet?.bodyId,
    masterTrajectorySegments,
    clearTrajectoryBuffer,
    fetchBlock,
  ]);

  // 2. Background pagination driven by segment coverage
  useFrame(() => {
    frameCountRef.current++;
    if (frameCountRef.current % 30 !== 0) return;

    const timeMs = currentTime.getTime();
    const { fetchSpanDays, thresholdDays } = getDynamicBufferParams();

    const liveSelectedBodyId = useSolarStore.getState().selectedPlanet?.bodyId;
    const bodyIds = buildFetchBodyIds(liveSelectedBodyId);

    let shouldPause = false;
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

      if (plan.pause) shouldPause = true;

      for (const date of plan.fetchDates) {
        fetchDates.add(date);
        if (!missingIdsForDate[date]) missingIdsForDate[date] = new Set();
        missingIdsForDate[date].add(id);
      }
    }

    if (shouldPause && isPlaying) {
      console.warn(
        "[TrajectoryManager] Playhead is outside loaded trajectory segments. Pausing playback.",
      );
      setIsPlaying(false);
    }

    for (const date of fetchDates) {
      const idsToFetch = Array.from(missingIdsForDate[date]);
      const preciseCacheKey = `page_${date}_${fetchSpanDays}_${idsToFetch.join(",")}`;

      if (!loadingRef.current.has(preciseCacheKey)) {
        loadingRef.current.add(preciseCacheKey);
        fetchBlock(date, fetchSpanDays, idsToFetch);

        // Let it retry/cleanup after a longer delay
        setTimeout(() => loadingRef.current.delete(preciseCacheKey), 10000);
      }
    }
  });

  return null;
}
