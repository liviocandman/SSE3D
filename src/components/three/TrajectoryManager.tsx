"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSolarStore } from "@/store/solarStore";
import { useShallow } from "zustand/react/shallow";
import { clockRuntime } from "@/lib/time/clockRuntime";
import { useTrajectoryClient } from "@/hooks/useTrajectoryClient";
import { useMoonOrbitLines } from "@/hooks/useMoonOrbitLines";
import { buildTrajectoryRequestKey, getCoverageToleranceMs } from '@/lib/trajectoryPolicy';
import { trajectoryRequestWindow } from '@/lib/trajectoryRequestWindow';
import { getTrajectoryRetryAt, isAbortError, TrajectoryRequestDeferredError } from '@/lib/trajectoryRequestErrors';
import { useQualityTier } from "@/contexts/QualityTierContext";
import {
  buildBackgroundPaginationDemands,
  buildCoverageDemands,
  buildFetchBodyIds,
  buildMoonOrbitPrefetchParentIds,
} from "@/lib/trajectoryAvailabilityPolicy";

const COVERAGE_DEBOUNCE_MS = 250;
const BACKGROUND_PAGINATION_EVERY_FRAMES = 300;

function toDateStringUTC(ms: number): string {
  return new Date(ms).toISOString().split("T")[0];
}

function debugTrajectoryLog(message: string): void {
  if (process.env.NODE_ENV !== "production") {
    console.info(message);
  }
}

interface PendingBlock {
  date: string;
  spanDays: number;
  ids: string[];
  seekRevision: number;
  controller: AbortController;
}

export function TrajectoryManager() {
  const { tier } = useQualityTier();
  const {
    currentDate,
    timeSeekRevision,
    timeMultiplier,
    selectedPlanet,
    hoveredPlanetId,
    appendTrajectoryData,
  } = useSolarStore(
    useShallow((s) => ({
      currentDate: s.currentDate,
      timeSeekRevision: s.timeSeekRevision,
      timeMultiplier: s.timeMultiplier,
      selectedPlanet: s.selectedPlanet,
      hoveredPlanetId: s.hoveredPlanetId,
      appendTrajectoryData: s.appendTrajectoryData,
    })),
  );

  const { requestTrajectoryBlock, requestOrbitLines } = useTrajectoryClient();
  const frameCountRef = useRef(0);
  const pendingBlocksRef = useRef(new Map<string, PendingBlock>());
  const bodyRetryAtRef = useRef(new Map<string, number>());

  useEffect(() => {
    const pending = pendingBlocksRef.current;
    return () => {
      for (const block of pending.values()) block.controller.abort();
      pending.clear();
    };
  }, []);

  const cancelObsoleteRequests = useCallback(() => {
    const state = useSolarStore.getState();
    const timeMs = clockRuntime.getTimeMs();
    const activeIds = new Set(buildFetchBodyIds([state.selectedPlanet?.bodyId, state.hoveredPlanetId]));
    for (const [key, block] of pendingBlocksRef.current) {
      const useful = block.seekRevision === state.timeSeekRevision && block.ids.some((id) => {
        if (!activeIds.has(id)) return false;
        const window = trajectoryRequestWindow(id, block.date, block.spanDays);
        const tolerance = getCoverageToleranceMs(id, state.timeMultiplier);
        return state.timeMultiplier >= 0
          ? window.endMs >= timeMs - tolerance
          : window.startMs <= timeMs + tolerance;
      });
      if (!useful) {
        block.controller.abort();
        pendingBlocksRef.current.delete(key);
      }
    }
  }, []);

  const fetchBlock = useCallback(async (date: string, spanDays: number, requestedIds: string[]): Promise<void> => {
    cancelObsoleteRequests();
    const state = useSolarStore.getState();
    const timeMs = clockRuntime.getTimeMs();
    const now = Date.now();
    const ids = requestedIds.filter((id) => {
      if ((bodyRetryAtRef.current.get(id) ?? 0) > now) return false;
      bodyRetryAtRef.current.delete(id);
      const wanted = trajectoryRequestWindow(id, date, spanDays);
      // Adjacent calendar days may ask for the same useful coverage with a
      // different URL. Share the pending window instead of cancelling/replacing it.
      return !Array.from(pendingBlocksRef.current.values()).some((block) => {
        if (!block.ids.includes(id)) return false;
        const pending = trajectoryRequestWindow(id, block.date, block.spanDays);
        return (pending.startMs <= timeMs && pending.endMs >= timeMs) ||
          (pending.startMs <= wanted.startMs && pending.endMs >= wanted.endMs);
      });
    });
    if (ids.length === 0) return;

    const key = buildTrajectoryRequestKey(date, spanDays, ids);
    const block: PendingBlock = {
      date, spanDays, ids, seekRevision: state.timeSeekRevision, controller: new AbortController(),
    };
    pendingBlocksRef.current.set(key, block);
    debugTrajectoryLog(`[TrajectoryManager] Loading block at ${date} (span: ${spanDays}d) for ${ids.length} bodies.`);
    try {
      const data = await requestTrajectoryBlock({ date, spanDays, ids, tier, signal: block.controller.signal });
      cancelObsoleteRequests();
      if (!block.controller.signal.aborted && block.seekRevision === useSolarStore.getState().timeSeekRevision && data.length > 0) {
        appendTrajectoryData(data);
      }
    } catch (error) {
      if (!block.controller.signal.aborted && !isAbortError(error)) {
        const retryAt = getTrajectoryRetryAt(error);
        if (retryAt !== undefined) for (const id of ids) bodyRetryAtRef.current.set(id, retryAt);
        if (!(error instanceof TrajectoryRequestDeferredError)) {
          console.error(`[TrajectoryManager] Failed to fetch block at ${date}:`, error);
        }
      }
    } finally {
      if (pendingBlocksRef.current.get(key) === block) pendingBlocksRef.current.delete(key);
    }
  }, [appendTrajectoryData, cancelObsoleteRequests, requestTrajectoryBlock, tier]);

  // A date snapshot requests coverage but never owns/cancels a useful request.
  // Explicit seeks carry their own revision, including seeks within one UTC day.
  useEffect(() => {
    cancelObsoleteRequests();
    const timer = setTimeout(() => {
      const state = useSolarStore.getState();
      const timeMs = clockRuntime.getTimeMs();
      const demands = buildCoverageDemands({
        bodyIds: buildFetchBodyIds([state.selectedPlanet?.bodyId, state.hoveredPlanetId]),
        segmentsByBody: state.masterTrajectorySegments,
        timeMs,
        date: toDateStringUTC(timeMs),
        timeMultiplier: state.timeMultiplier,
      });
      for (const demand of demands) void fetchBlock(demand.date, demand.fetchSpanDays, demand.ids);
    }, COVERAGE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [currentDate, timeSeekRevision, selectedPlanet?.bodyId, hoveredPlanetId, timeMultiplier, fetchBlock, cancelObsoleteRequests]);

  useMoonOrbitLines(buildMoonOrbitPrefetchParentIds(
    selectedPlanet?.bodyId, selectedPlanet?.parentId, hoveredPlanetId,
  ), requestOrbitLines);

  // 2. Background pagination driven by segment coverage
  useFrame(() => {
    frameCountRef.current++;
    if (frameCountRef.current % BACKGROUND_PAGINATION_EVERY_FRAMES !== 0) return;

    cancelObsoleteRequests();
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
