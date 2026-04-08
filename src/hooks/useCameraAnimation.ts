/**
 * useCameraAnimation Hook
 * Provides smooth, stable camera animation with kinematic constraints and origin smoothing.
 * Supports V1 (camera-centric) and V2 (origin-centric) models via feature flag.
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
import { CAMERA_MODEL_V2_ORIGIN_ONLY } from "@/lib/types";
import { createTemporalLookupCache } from "@/lib/temporalLookup";
import { sampleTrajectoryAtTime } from "@/lib/trajectoryEngine";
import { PLANET_MOONS } from "@/lib/textureConfig";
import { clockRuntime } from "@/lib/time/clockRuntime";

// --- Types ---

interface CameraTarget {
  /** Desired camera offset relative to target in units */
  localOffsetUnits: THREE.Vector3;
}

interface UseCameraAnimationOptions {
  /** Offset distance from target */
  offsetDistance?: number;
}

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

export function useCameraAnimation(
  options: UseCameraAnimationOptions = {},
): UseCameraAnimationReturn {
  const {
    offsetDistance = CAMERA_CONFIG.DEFAULT_OFFSET[2],
  } = options;

  const { camera, controls, scene } = useThree();

  // --- Common Refs ---
  const isAnimatingRef = useRef(false);
  const targetObjectNameRef = useRef<string | null>(null);
  const targetRef = useRef<CameraTarget | null>(null);
  
  const pool = useRef({
    v1: new THREE.Vector3(),
    v2: new THREE.Vector3(),
    v3: new THREE.Vector3(),
    v4: new THREE.Vector3(),
    worldPos: new THREE.Vector3(),
    prevPos: new THREE.Vector3(),
  });
  const followLookupCacheRef = useRef(createTemporalLookupCache());
  const followParentLookupCacheRef = useRef(createTemporalLookupCache());

  const isUserDraggingRef = useRef(false);

  useEffect(() => {
    if (!controls) return;
    const ctrl = controls as unknown as OrbitControlsLike;
    const onStart = () => { isUserDraggingRef.current = true; };
    const onEnd = () => { isUserDraggingRef.current = false; };
    ctrl.addEventListener('start', onStart);
    ctrl.addEventListener('end', onEnd);
    return () => {
      ctrl.removeEventListener('start', onStart);
      ctrl.removeEventListener('end', onEnd);
    };
  }, [controls]);

  // --- V1 Refs (Restored) ---
  const currentPivotUnits = useRef(new THREE.Vector3(0, 0, 0));
  const currentOffsetUnits = useRef(new THREE.Vector3().set(...CAMERA_CONFIG.DEFAULT_OFFSET));
  const targetOriginKm = useRef(new THREE.Vector3(0, 0, 0));
  const displayOriginKm = useRef(new THREE.Vector3(0, 0, 0));

  // Animation frame loop
  useFrame((_, delta) => {
    const solarStore = useSolarStore.getState();
    const { v1, v2, v3, v4, worldPos, prevPos } = pool.current;

    if (CAMERA_MODEL_V2_ORIGIN_ONLY) {
      // ==========================================
      // V2: ORIGIN-ONLY MODEL
      // ==========================================
      const { cameraNavMode, originStartKm, originTargetKm, travelStartMs, travelDurationMs, followTargetId } = solarStore;
      const now = performance.now();

      // 1. Resolve Navigation State -> Next Origin Target
      if (cameraNavMode === 'travel') {
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
      else if (cameraNavMode === 'follow' && followTargetId) {
        // Authoritative Source of Truth lookup (Avoid getObjectByName jitter)
        let authoritativePosKm: { x: number; y: number; z: number } | null = null;
        const state = useSolarStore.getState();
        const simTimeMs = clockRuntime.getTimeMs();

        // 1) Planet/moon source from trajectory segments at current sim time.
        const masterSegments = state.masterTrajectorySegments[followTargetId] ?? [];
        if (masterSegments.length > 0) {
          const sampled = sampleTrajectoryAtTime(
            masterSegments,
            simTimeMs,
            followLookupCacheRef.current
          );
          if (sampled) {
            const parentId = MOON_PARENT_BY_ID[followTargetId];
            if (parentId) {
              const parentSegments = state.masterTrajectorySegments[parentId] ?? [];
              const sampledParent = parentSegments.length > 0
                ? sampleTrajectoryAtTime(
                  parentSegments,
                  simTimeMs,
                  followParentLookupCacheRef.current
                )
                : null;

              if (sampledParent) {
                // Moon trajectories are parent-relative KM. Convert to absolute KM here.
                authoritativePosKm = {
                  x: sampledParent.position.x + sampled.position.x,
                  y: sampledParent.position.y + sampled.position.y,
                  z: sampledParent.position.z + sampled.position.z,
                };
              } else if (state.selectedPlanet?.bodyId === followTargetId) {
                authoritativePosKm = state.selectedPlanet.position;
              }
            } else {
              authoritativePosKm = sampled.position;
            }
          }
        }

        // 2) Orion authoritative source: mission state globalCoordinates (absolute KM).
        if (!authoritativePosKm && (followTargetId === 'Orion' || followTargetId === 'orion')) {
          const missionState = useMissionStore.getState().missionState;
          if (missionState?.globalCoordinates) {
            authoritativePosKm = missionState.globalCoordinates;
          }
        }
        
        if (authoritativePosKm) {
          if (!isRenderOriginNearTarget(solarStore.renderOrigin, authoritativePosKm, 0.000001)) {
            solarStore.setRenderOrigin(authoritativePosKm, 'selected_body');
          }
        }
      }

      // 2. Enforce Stable Controls Target
      if (controls) {
        const ctrl = controls as unknown as OrbitControlsLike;
        if (ctrl.target && ctrl.target.lengthSq() > 0.000001) {
          ctrl.target.set(0, 0, 0);
          ctrl.update();
        }
      }
    } else {
      // ==========================================
      // V1: CAMERA-CENTRIC MODEL (Restored)
      // ==========================================
      const solarState = solarStore;
      let hasTarget = false;
      v1.set(solarState.renderOrigin.x, solarState.renderOrigin.y, solarState.renderOrigin.z);

      if (targetObjectNameRef.current) {
        const obj = scene.getObjectByName(targetObjectNameRef.current);
        if (obj) {
          obj.getWorldPosition(worldPos);
          v2.set(
            v1.x + worldPos.x / KM_TO_UNIT,
            v1.y + worldPos.y / KM_TO_UNIT,
            v1.z + worldPos.z / KM_TO_UNIT
          );
          hasTarget = true;
        }
      }

      if (hasTarget) {
        const distToTargetOriginKm = v2.distanceTo(targetOriginKm.current);
        if (distToTargetOriginKm > CAMERA_CONFIG.ORIGIN_HYSTERESIS_KM) {
          targetOriginKm.current.copy(v2);
        }

        const originDamp = 1000 / CAMERA_CONFIG.ORIGIN_SMOOTHING_MS; 
        displayOriginKm.current.x = THREE.MathUtils.damp(displayOriginKm.current.x, targetOriginKm.current.x, originDamp, delta);
        displayOriginKm.current.y = THREE.MathUtils.damp(displayOriginKm.current.y, targetOriginKm.current.y, originDamp, delta);
        displayOriginKm.current.z = THREE.MathUtils.damp(displayOriginKm.current.z, targetOriginKm.current.z, originDamp, delta);

        if (!isRenderOriginNearTarget(solarState.renderOrigin, displayOriginKm.current, 0.000001)) {
          solarStore.setRenderOrigin(displayOriginKm.current, 'custom');
          v3.set(v1.x - displayOriginKm.current.x, v1.y - displayOriginKm.current.y, v1.z - displayOriginKm.current.z)
            .multiplyScalar(KM_TO_UNIT);
          currentPivotUnits.current.add(v3);
        }
      }

      const idealPivot = v4.set(0, 0, 0);
      const idealOffset = targetRef.current?.localOffsetUnits || currentOffsetUnits.current;
      const pDamp = isUserDraggingRef.current ? CAMERA_CONFIG.DAMPING_INTERACTION : CAMERA_CONFIG.DAMPING_PIVOT;
      const oDampFactor = isAnimatingRef.current ? 4 : CAMERA_CONFIG.DAMPING_OFFSET;

      prevPos.copy(camera.position);

      const pivotErrorSq = currentPivotUnits.current.distanceToSquared(idealPivot);
      if (pivotErrorSq > CAMERA_CONFIG.DEAD_ZONE_UNITS * CAMERA_CONFIG.DEAD_ZONE_UNITS || isAnimatingRef.current) {
        currentPivotUnits.current.x = THREE.MathUtils.damp(currentPivotUnits.current.x, idealPivot.x, pDamp, delta);
        currentPivotUnits.current.y = THREE.MathUtils.damp(currentPivotUnits.current.y, idealPivot.y, pDamp, delta);
        currentPivotUnits.current.z = THREE.MathUtils.damp(currentPivotUnits.current.z, idealPivot.z, pDamp, delta);
      }

      currentOffsetUnits.current.x = THREE.MathUtils.damp(currentOffsetUnits.current.x, idealOffset.x, oDampFactor, delta);
      currentOffsetUnits.current.y = THREE.MathUtils.damp(currentOffsetUnits.current.y, idealOffset.y, oDampFactor, delta);
      currentOffsetUnits.current.z = THREE.MathUtils.damp(currentOffsetUnits.current.z, idealOffset.z, oDampFactor, delta);

      v1.addVectors(currentPivotUnits.current, currentOffsetUnits.current);
      v3.subVectors(v1, prevPos);
      const distMoved = v3.length();
      const maxMove = CAMERA_CONFIG.MAX_LINEAR_SPEED * delta;

      if (distMoved > maxMove && maxMove > 0) {
        v3.normalize().multiplyScalar(maxMove);
        v1.addVectors(prevPos, v3);
      }

      camera.position.copy(v1);

      if (controls && "target" in controls) {
        (controls.target as THREE.Vector3).copy(currentPivotUnits.current);
        (controls as unknown as OrbitControlsLike).update();
      }
      camera.lookAt(currentPivotUnits.current);

      if (isAnimatingRef.current) {
        const offsetDistSq = currentOffsetUnits.current.distanceToSquared(idealOffset);
        if (pivotErrorSq < 1e-10 && offsetDistSq < 1e-10) {
          isAnimatingRef.current = false;
        }
      }
    }
  });

  const focusOn = (
    targetPositionKm: { x: number; y: number; z: number },
    radiusKm?: number,
    targetId?: string,
  ) => {
    const solarStore = useSolarStore.getState();
    if (CAMERA_MODEL_V2_ORIGIN_ONLY) {
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
    } else {
      const { v1, v2, v3, worldPos } = pool.current;
      v1.set(solarStore.renderOrigin.x, solarStore.renderOrigin.y, solarStore.renderOrigin.z);
      v2.set(targetPositionKm.x, targetPositionKm.y, targetPositionKm.z);
      if (targetId) {
        const obj = scene.getObjectByName(targetId);
        if (obj) {
          obj.getWorldPosition(worldPos);
          v2.set(worldPos.x / KM_TO_UNIT + v1.x, worldPos.y / KM_TO_UNIT + v1.y, worldPos.z / KM_TO_UNIT + v1.z);
        }
      }
      targetOriginKm.current.copy(v2);
      const dynamicOffset = radiusKm ? Math.max(CAMERA_CONFIG.MIN_FOCUS_OFFSET, radiusKm * KM_TO_UNIT * CAMERA_CONFIG.FOCUS_RADIUS_MULTIPLIER) : offsetDistance;
      v3.set(0, dynamicOffset * 0.3, dynamicOffset);
      targetRef.current = { localOffsetUnits: v3.clone() };
      targetObjectNameRef.current = targetId || null;
      isAnimatingRef.current = true;
    }
  };

  const stopTracking = () => {
    const solarStore = useSolarStore.getState();
    if (CAMERA_MODEL_V2_ORIGIN_ONLY) {
      solarStore.stopOriginNavigation();
    } else {
      targetRef.current = null;
      targetObjectNameRef.current = null;
      isAnimatingRef.current = false;
    }
  };

  const resetCamera = () => {
    const solarStore = useSolarStore.getState();
    if (CAMERA_MODEL_V2_ORIGIN_ONLY) {
      solarStore.startOriginTravel({ x: 0, y: 0, z: 0 }, 2000, performance.now());
    } else {
      targetOriginKm.current.set(0, 0, 0);
      targetRef.current = { localOffsetUnits: new THREE.Vector3().set(...CAMERA_CONFIG.DEFAULT_OFFSET) };
      targetObjectNameRef.current = null;
      isAnimatingRef.current = true;
    }
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

  useEffect(() => {
    if (targetPositionKm) {
      if (targetId !== prevTargetId.current) {
        focusOn(targetPositionKm, targetRadiusKm, targetId);
        prevTargetId.current = targetId;
      }
    } else {
      if (prevTargetId.current) {
        stopTracking();
        prevTargetId.current = undefined;
      }
    }
  }, [targetPositionKm, targetRadiusKm, targetId, focusOn, stopTracking]);

  return null;
}
