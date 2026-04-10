/**
 * useCameraAnimation Hook
 * Provides smooth, stable camera animation with kinematic constraints and origin smoothing.
 * Frozen on V2 (Origin-Only) model.
 */

"use client";

import { useRef, useEffect } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSolarStore } from "@/store/solarStore";
import { useMissionStore } from "@/store/missionStore";
import { KM_TO_UNIT } from "@/lib/scales";
import { isRenderOriginNearTarget } from "@/lib/renderFrame";
import { CAMERA_CONFIG } from "@/lib/cameraConfig";
import { createTemporalLookupCache, type TemporalLookupCache } from "@/lib/temporalLookup";
import { sampleTrajectoryAtTime } from "@/lib/trajectoryEngine";
import { PLANET_MOONS } from "@/lib/textureConfig";
import { clockRuntime } from "@/lib/time/clockRuntime";
import { BODY_IDS } from "@/lib/types";

// --- Types ---

interface UseCameraAnimationReturn {
  /** Animate camera to look at a position (Absolute KM) */
  focusOn: (
    targetPositionKm: { x: number; y: number; z: number },
    radiusKm?: number,
    targetId?: string,
  ) => void;
  /** Stop tracking/animation */
  stopTracking: () => void;
  /** Reset camera to default position */
  resetCamera: () => void;
}

// --- Smooth Easing ---
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

const MOON_PARENT_BY_ID: Record<string, string> = Object.entries(PLANET_MOONS).reduce(
  (acc, [parentId, moonIds]) => {
    moonIds.forEach((moonId) => {
      acc[moonId] = parentId;
    });
    return acc;
  },
  {} as Record<string, string>
);

interface OrbitControlsLike {
  target: THREE.Vector3;
  update: () => void;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

// --- Internal Helpers ---

function resolveFollowTargetAbsoluteKm(
  followTargetId: string,
  lookupCache: TemporalLookupCache,
  parentLookupCache: TemporalLookupCache
): { x: number; y: number; z: number } | null {
  const state = useSolarStore.getState();
  const simTimeMs = clockRuntime.getTimeMs();

  // 1) Planet/moon source from trajectory segments at current sim time.
  const masterSegments = state.masterTrajectorySegments[followTargetId] ?? [];
  if (masterSegments.length > 0) {
    const sampled = sampleTrajectoryAtTime(masterSegments, simTimeMs, lookupCache);
    if (sampled) {
      const parentId = MOON_PARENT_BY_ID[followTargetId];
      if (parentId) {
        const parentSegments = state.masterTrajectorySegments[parentId] ?? [];
        const sampledParent = parentSegments.length > 0
          ? sampleTrajectoryAtTime(parentSegments, simTimeMs, parentLookupCache)
          : null;

        if (sampledParent) {
          return {
            x: sampledParent.position.x + sampled.position.x,
            y: sampledParent.position.y + sampled.position.y,
            z: sampledParent.position.z + sampled.position.z,
          };
        } else if (state.selectedPlanet?.bodyId === followTargetId) {
          return state.selectedPlanet.position;
        }
      } else {
        return sampled.position;
      }
    }
  }

  // 2) Orion authoritative source: mission state sceneCoordinates (Earth-relative KM).
  if (followTargetId === 'Orion' || followTargetId === 'orion') {
    const missionState = useMissionStore.getState().missionState;
    const sceneCoordinates = missionState?.sceneCoordinates;
    if (
      sceneCoordinates &&
      Number.isFinite(sceneCoordinates.x) &&
      Number.isFinite(sceneCoordinates.y) &&
      Number.isFinite(sceneCoordinates.z)
    ) {
      const earthSegments = state.masterTrajectorySegments[BODY_IDS.EARTH] ?? [];
      const sampledEarth = earthSegments.length > 0
        ? sampleTrajectoryAtTime(earthSegments, simTimeMs, parentLookupCache)
        : null;

      if (sampledEarth?.position) {
        return {
          x: sampledEarth.position.x + sceneCoordinates.x,
          y: sampledEarth.position.y + sceneCoordinates.y,
          z: sampledEarth.position.z + sceneCoordinates.z,
        };
      } else if (state.selectedPlanet?.bodyId === BODY_IDS.EARTH) {
        return {
          x: state.selectedPlanet.position.x + sceneCoordinates.x,
          y: state.selectedPlanet.position.y + sceneCoordinates.y,
          z: state.selectedPlanet.position.z + sceneCoordinates.z,
        };
      }
    }
  }

  return null;
}

function runTravelStep(
  v1: THREE.Vector3,
  v2: THREE.Vector3,
  v3: THREE.Vector3
) {
  const solarStore = useSolarStore.getState();
  const { originStartKm, originTargetKm, travelStartMs, travelDurationMs, followTargetId } = solarStore;
  const now = performance.now();

  const elapsed = now - travelStartMs;
  let t = Math.min(1, elapsed / travelDurationMs);
  t = smootherstep(t);

  v1.set(originStartKm.x, originStartKm.y, originStartKm.z);
  v2.set(originTargetKm.x, originTargetKm.y, originTargetKm.z);
  v3.lerpVectors(v1, v2, t);

  if (!isRenderOriginNearTarget(solarStore.renderOrigin, v3, 0.000001)) {
    solarStore.setRenderOrigin({ x: v3.x, y: v3.y, z: v3.z }, 'custom');
  }

  if (t >= 1) {
    if (followTargetId) {
      solarStore.setFollowTarget(followTargetId);
    } else {
      solarStore.stopOriginNavigation();
    }
  }
}

function runFollowStep(
  followTargetId: string,
  lookupCache: TemporalLookupCache,
  parentLookupCache: TemporalLookupCache
) {
  const authoritativePosKm = resolveFollowTargetAbsoluteKm(followTargetId, lookupCache, parentLookupCache);
  if (authoritativePosKm) {
    const solarStore = useSolarStore.getState();
    if (!isRenderOriginNearTarget(solarStore.renderOrigin, authoritativePosKm, 0.000001)) {
      solarStore.setRenderOrigin(authoritativePosKm, 'selected_body');
    }
  }
}

function enforceControlsTarget(controls: unknown) {
  const ctrl = controls as OrbitControlsLike | null | undefined;
  if (!ctrl?.target) return;
  if (ctrl.target.lengthSq() > 0.000001) {
    ctrl.target.set(0, 0, 0);
    ctrl.update();
  }
}

export function useCameraAnimation(): UseCameraAnimationReturn {
  const { camera, controls } = useThree();

  const pool = useRef({
    v1: new THREE.Vector3(),
    v2: new THREE.Vector3(),
    v3: new THREE.Vector3(),
  });
  const followLookupCacheRef = useRef(createTemporalLookupCache());
  const followParentLookupCacheRef = useRef(createTemporalLookupCache());

  // Animation frame loop
  useFrame(() => {
    const solarStore = useSolarStore.getState();
    const { v1, v2, v3 } = pool.current;
    const { cameraNavMode, followTargetId } = solarStore;

    if (cameraNavMode === 'travel') {
      runTravelStep(v1, v2, v3);
    } 
    else if (cameraNavMode === 'follow' && followTargetId) {
      runFollowStep(followTargetId, followLookupCacheRef.current, followParentLookupCacheRef.current);
    }

    enforceControlsTarget(controls);
  });

  const focusOn = (
    targetPositionKm: { x: number; y: number; z: number },
    radiusKm?: number,
    targetId?: string,
  ) => {
    const solarStore = useSolarStore.getState();
    const currentOrigin = solarStore.renderOrigin;
    const distanceKm = Math.sqrt(
      Math.pow(targetPositionKm.x - currentOrigin.x, 2) +
      Math.pow(targetPositionKm.y - currentOrigin.y, 2) +
      Math.pow(targetPositionKm.z - currentOrigin.z, 2)
    );

    const durationMs = Math.max(1000, Math.min(4000, Math.log10(distanceKm + 1) * 1000));
    solarStore.startOriginTravel(targetPositionKm, durationMs, performance.now(), targetId ?? null);

    if (radiusKm) {
      const framingDistance = Math.max(CAMERA_CONFIG.MIN_FOCUS_OFFSET, radiusKm * KM_TO_UNIT * CAMERA_CONFIG.FOCUS_RADIUS_MULTIPLIER);
      camera.position.setLength(framingDistance);
    }
  };

  const stopTracking = () => {
    useSolarStore.getState().stopOriginNavigation();
  };

  const resetCamera = () => {
    useSolarStore.getState().startOriginTravel({ x: 0, y: 0, z: 0 }, 2000, performance.now());
  };

  return {
    focusOn,
    stopTracking,
    resetCamera,
  };
}

// --- Standalone Component for Scene Integration ---

interface CameraControllerProps {
  targetPositionKm?: { x: number; y: number; z: number } | null;
  targetRadiusKm?: number;
  targetId?: string;
}

export function CameraController({
  targetPositionKm,
  targetRadiusKm,
  targetId,
}: CameraControllerProps) {
  const { focusOn, stopTracking } = useCameraAnimation();
  const prevTargetId = useRef<string | undefined>(undefined);
  const prevTargetPositionKm = useRef<{ x: number; y: number; z: number } | null>(null);
  const TARGET_POSITION_EPSILON_KM = 1;

  useEffect(() => {
    if (targetPositionKm) {
      const prevPos = prevTargetPositionKm.current;
      const targetMovedEnough =
        !prevPos ||
        Math.abs(prevPos.x - targetPositionKm.x) > TARGET_POSITION_EPSILON_KM ||
        Math.abs(prevPos.y - targetPositionKm.y) > TARGET_POSITION_EPSILON_KM ||
        Math.abs(prevPos.z - targetPositionKm.z) > TARGET_POSITION_EPSILON_KM;

      if (targetId !== prevTargetId.current || targetMovedEnough) {
        focusOn(targetPositionKm, targetRadiusKm, targetId);
        prevTargetId.current = targetId;
        prevTargetPositionKm.current = targetPositionKm;
      }
    } else {
      if (prevTargetId.current) {
        stopTracking();
        prevTargetId.current = undefined;
        prevTargetPositionKm.current = null;
      }
    }
  }, [targetPositionKm, targetRadiusKm, targetId, focusOn, stopTracking]);

  return null;
}
