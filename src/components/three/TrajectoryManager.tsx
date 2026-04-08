"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSolarStore } from "@/store/solarStore";
import { useShallow } from "zustand/react/shallow";
import { PLANET_MOONS } from "@/lib/textureConfig";
import { computeBufferPlan, hasCoverageNearTime } from "@/lib/trajectoryEngine";
import { useTrajectoryWorker } from "@/hooks/useTrajectoryWorker";

import { useQualityTier } from "@/contexts/QualityTierContext";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const BASE_COVERAGE_TOLERANCE_MS = 6 * HOUR_MS;
const MIN_COVERAGE_TOLERANCE_MS = 30 * MINUTE_MS;
const MOON_MIN_COVERAGE_TOLERANCE_MS = 15 * MINUTE_MS;
const MOON_MAX_COVERAGE_TOLERANCE_MS = 2 * HOUR_MS;
const RAPID_MOON_IDS = new Set(["401", "402"]);

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

function isMoonBody(bodyId: string): boolean {
  for (const moons of Object.values(PLANET_MOONS)) {
    if (moons.includes(bodyId)) return true;
  }
  return false;
}

function getCoverageToleranceMs(bodyId: string, timeMultiplier: number): number {
  const adaptiveMs = Math.abs(timeMultiplier) * MINUTE_MS;
  if (RAPID_MOON_IDS.has(bodyId)) {
    return Math.max(MOON_MIN_COVERAGE_TOLERANCE_MS, Math.min(adaptiveMs, MOON_MAX_COVERAGE_TOLERANCE_MS));
  }
  if (isMoonBody(bodyId)) {
    return Math.max(MOON_MIN_COVERAGE_TOLERANCE_MS, Math.min(adaptiveMs, BASE_COVERAGE_TOLERANCE_MS));
  }
  return Math.max(MIN_COVERAGE_TOLERANCE_MS, Math.min(adaptiveMs, BASE_COVERAGE_TOLERANCE_MS));
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
  } = useSolarStore(
    useShallow((s) => ({
      currentDate: s.currentDate,
      timeMultiplier: s.timeMultiplier,
      selectedPlanet: s.selectedPlanet,
      hoveredPlanetId: s.hoveredPlanetId,
      appendTrajectoryData: s.appendTrajectoryData,
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
    const timeouts = activeTimeouts.current;
    const loading = loadingRef.current;
    return () => {
      // Clear all pending lock removals
      timeouts.forEach(clearTimeout);
      timeouts.clear();
      loading.clear();
      
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
        const timerId = setTimeout(() => {
          loadingRef.current.delete(blockCacheKey);
          activeTimeouts.current.delete(timerId);
        }, 5000);
        activeTimeouts.current.add(timerId);
      }
    },
    [appendTrajectoryData, fetchTrajectory, tier],
  );

  // 1A. Time Travel Fetch (DEBOUNCED)
  // Only fires when scrubbing the timeline aggressively.
  useEffect(() => {
    if (lastFetchRef.current === currentDate) return;

    const debounceTimeout = setTimeout(() => {
      const bodyIds = buildFetchBodyIds([selectedPlanet?.bodyId, hoveredPlanetId]);
      const state = useSolarStore.getState();
      const timeMs = state.currentTime.getTime();
      const segmentsByBody = state.masterTrajectorySegments;
      const { fetchSpanDays } = getDynamicBufferParams();

      const missingIds = bodyIds.filter((id) => {
        const segments = segmentsByBody[id] || [];
        const toleranceMs = getCoverageToleranceMs(id, timeMultiplier);
        return !hasCoverageNearTime(segments, timeMs, toleranceMs);
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
  }, [currentDate, hoveredPlanetId, selectedPlanet?.bodyId, fetchBlock, timeMultiplier]);

  // 1B. Target Change Fetch (IMMEDIATE)
  // Fires instantly when hovering or clicking a new planet (0ms delay).
  // Does NOT abort previous requests to avoid killing the Eager Load.
  useEffect(() => {
    const targetIds = buildFetchBodyIds([selectedPlanet?.bodyId, hoveredPlanetId]);
    const state = useSolarStore.getState();
    const timeMs = state.currentTime.getTime();
    const segmentsByBody = state.masterTrajectorySegments;
    const { fetchSpanDays } = getDynamicBufferParams();

    const missingIds = targetIds.filter((id) => {
      const segments = segmentsByBody[id] || [];
      const toleranceMs = getCoverageToleranceMs(id, timeMultiplier);
      return !hasCoverageNearTime(segments, timeMs, toleranceMs);
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
  }, [selectedPlanet?.bodyId, hoveredPlanetId, currentDate, fetchBlock, timeMultiplier]);

  // 2. Background pagination driven by segment coverage
  useFrame(() => {
    frameCountRef.current++;
    if (frameCountRef.current % 60 !== 0) return;

    const state = useSolarStore.getState();
    const timeMs = state.currentTime.getTime();
    const { fetchSpanDays, thresholdDays } = getDynamicBufferParams();

    const segmentsByBody = state.masterTrajectorySegments;
    const bodyIds = buildFetchBodyIds([state.selectedPlanet?.bodyId, state.hoveredPlanetId]);

    const fetchDates = new Set<string>();
    const missingIdsForDate: Record<string, Set<string>> = {};

    for (const id of bodyIds) {
      const segments = segmentsByBody[id] || [];
      const plan = computeBufferPlan({
        segments,
        timeMs,
        thresholdDays,
        fetchSpanDays,
        timeMultiplier,
        currentDate: state.currentDate,
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
