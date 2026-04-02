"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSolarStore } from "@/store/solarStore";
import { useShallow } from "zustand/react/shallow";
import { PLANET_MOONS } from "@/lib/textureConfig";
import { computeBufferPlan, hasCoverageNearTime } from "@/lib/trajectoryEngine";
import { useTrajectoryWorker } from "@/hooks/useTrajectoryWorker";

import { useQualityTier } from "@/contexts/QualityTierContext";

const COVERAGE_TOLERANCE_MS = 48 * 60 * 60 * 1000; // Increased to 48h to avoid flickering at segment boundaries

// Eager load Jupiter (599) and Saturn (699) since they are the most visited and have many moons
const CORE_PLANET_IDS = [
  "199", "299", "399", "499", "599", "699", "799", "899"
];

export function getDynamicBufferParams() {
  // 30 days of data with a 15-day prefetch threshold.
  return { fetchSpanDays: 30, thresholdDays: 15 };
}

export function buildFetchBodyIds(activeIds: (string | null | undefined)[]): string[] {
  const ids = new Set(CORE_PLANET_IDS); // Set ensures uniqueness

  // Always eager load moons for Jupiter and Saturn
  if (PLANET_MOONS["599"]) PLANET_MOONS["599"].forEach(id => ids.add(id));
  if (PLANET_MOONS["699"]) PLANET_MOONS["699"].forEach(id => ids.add(id));

  activeIds.forEach(bodyId => {
    if (!bodyId) return;
    ids.add(bodyId);
    if (PLANET_MOONS[bodyId]) {
      PLANET_MOONS[bodyId].forEach((moonId) => ids.add(moonId));
    }
  });

  return Array.from(ids);
}

export function TrajectoryManager() {
  const { tier } = useQualityTier();
  const {
    currentTime,
    currentDate,
    timeMultiplier,
    selectedPlanet,
    hoveredPlanetId,
    masterTrajectorySegments,
    appendTrajectoryData,
  } = useSolarStore(
    useShallow((s) => ({
      currentTime: s.currentTime,
      currentDate: s.currentDate,
      timeMultiplier: s.timeMultiplier,
      selectedPlanet: s.selectedPlanet,
      hoveredPlanetId: s.hoveredPlanetId,
      masterTrajectorySegments: s.masterTrajectorySegments,
      appendTrajectoryData: s.appendTrajectoryData,
      clearTrajectoryBuffer: s.clearTrajectoryBuffer,
    })),
  );

  const { fetchTrajectory } = useTrajectoryWorker();
  const loadingRef = useRef<Set<string>>(new Set());
  const activeTimeouts = useRef<Set<NodeJS.Timeout>>(new Set());
  const frameCountRef = useRef(0);
  const lastFetchRef = useRef<string | null>(null);
  const jumpAbortControllerRef = useRef<AbortController | null>(null);

  // Cleanup on unmount or major jumps
  useEffect(() => {
    return () => {
      // Clear all pending lock removals
      activeTimeouts.current.forEach(clearTimeout);
      activeTimeouts.current.clear();
      loadingRef.current.clear();
      
      if (jumpAbortControllerRef.current) {
        jumpAbortControllerRef.current.abort();
      }
    };
  }, []);

  const fetchBlock = useCallback(
    async (date: string, spanDays: number, specificIds?: string[], signal?: AbortSignal) => {
      const state = useSolarStore.getState();
      const ids =
        specificIds && specificIds.length > 0
          ? specificIds
          : buildFetchBodyIds([state.selectedPlanet?.bodyId, state.hoveredPlanetId]);

      const blockCacheKey = `block_${date}_${spanDays}_${ids.join(",")}`;
      if (loadingRef.current.has(blockCacheKey)) {
        return;
      }

      loadingRef.current.add(blockCacheKey);
      console.log(
        `[TrajectoryManager] Worker-powered Loading block starting at ${date} (span: ${spanDays}d) for ${ids.length} bodies...`,
      );

      try {
        const data = await fetchTrajectory(date, spanDays, ids, tier, signal);
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
        const timerId = setTimeout(() => {
          loadingRef.current.delete(blockCacheKey);
          activeTimeouts.current.delete(timerId);
        }, 5000);
        activeTimeouts.current.add(timerId);
      }
    },
    [appendTrajectoryData, fetchTrajectory],
  );

  // 1A. Time Travel Fetch (DEBOUNCED)
  // Only fires when scrubbing the timeline aggressively.
  useEffect(() => {
    if (lastFetchRef.current === currentDate) return;

    const debounceTimeout = setTimeout(() => {
      const bodyIds = buildFetchBodyIds([selectedPlanet?.bodyId, hoveredPlanetId]);
      const timeMs = currentTime.getTime();
      const { fetchSpanDays } = getDynamicBufferParams();

      const missingIds = bodyIds.filter((id) => {
        const segments = masterTrajectorySegments[id] || [];
        return !hasCoverageNearTime(segments, timeMs, COVERAGE_TOLERANCE_MS);
      });

      if (missingIds.length > 0) {
        const cacheKey = `jump_${currentDate}_${fetchSpanDays}_${missingIds.join(",")}`;

        if (!loadingRef.current.has(cacheKey)) {
          if (jumpAbortControllerRef.current) {
            jumpAbortControllerRef.current.abort();
          }
          jumpAbortControllerRef.current = new AbortController();

          loadingRef.current.add(cacheKey);
          fetchBlock(currentDate, fetchSpanDays, missingIds, jumpAbortControllerRef.current.signal);
          lastFetchRef.current = currentDate;

          setTimeout(() => loadingRef.current.delete(cacheKey), 5000);
        }
      }
    }, 300);

    return () => clearTimeout(debounceTimeout);
  }, [currentDate, currentTime, selectedPlanet?.bodyId, hoveredPlanetId, masterTrajectorySegments, fetchBlock]);

  // 1B. Target Change Fetch (IMMEDIATE)
  // Fires instantly when hovering or clicking a new planet (0ms delay).
  // Does NOT abort previous requests to avoid killing the Eager Load.
  useEffect(() => {
    const targetIds = buildFetchBodyIds([selectedPlanet?.bodyId, hoveredPlanetId]);
    const timeMs = currentTime.getTime();
    const { fetchSpanDays } = getDynamicBufferParams();

    const missingIds = targetIds.filter((id) => {
      const segments = masterTrajectorySegments[id] || [];
      return !hasCoverageNearTime(segments, timeMs, COVERAGE_TOLERANCE_MS);
    });

    if (missingIds.length > 0) {
      const cacheKey = `target_${currentDate}_${fetchSpanDays}_${missingIds.join(",")}`;

      if (!loadingRef.current.has(cacheKey)) {
        loadingRef.current.add(cacheKey);
        // Notice: No abort signal passed here. We don't want a hover to cancel a click.
        fetchBlock(currentDate, fetchSpanDays, missingIds);
        setTimeout(() => loadingRef.current.delete(cacheKey), 5000);
      }
    }
  }, [selectedPlanet?.bodyId, hoveredPlanetId, currentDate, currentTime, masterTrajectorySegments, fetchBlock]);

  // 2. Background pagination driven by segment coverage
  useFrame(() => {
    frameCountRef.current++;
    if (frameCountRef.current % 60 !== 0) return;

    const timeMs = currentTime.getTime();
    const { fetchSpanDays, thresholdDays } = getDynamicBufferParams();

    const state = useSolarStore.getState();
    const bodyIds = buildFetchBodyIds([state.selectedPlanet?.bodyId, state.hoveredPlanetId]);

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
