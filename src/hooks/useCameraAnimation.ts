/**
 * useCameraAnimation Hook
 * Provides smooth, stable camera animation with kinematic constraints and origin smoothing.
 * The origin and camera settle before visible bodies consume the current frame.
 */

"use client";

import { useRef, useEffect, useCallback } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSolarStore } from "@/store/solarStore";
import { getMoonOrbitScale, KM_TO_UNIT, type ViewMode } from "@/lib/scales";
import { getPlanetConfig, PLANET_MOONS } from "@/lib/textureConfig";
import { isRenderOriginNearTarget } from "@/lib/renderFrame";
import { CAMERA_CONFIG, getBodyCameraFraming } from "@/lib/cameraConfig";
import { FRAME_PRIORITIES } from "@/lib/framePriorities";
import { createTemporalLookupCache, type TemporalLookupCache } from "@/lib/temporalLookup";
import { clockRuntime } from "@/lib/time/clockRuntime";
import { resolveGeneralTargetFrame } from "@/lib/simulation/frameResolvers";

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

interface OrbitControlsLike {
  target: THREE.Vector3;
  update: () => void;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

// --- Internal Helpers ---

function resolveNavigationTarget(
  bodyId: string,
  viewMode: ViewMode,
  out: THREE.Vector3,
  parentPosition: THREE.Vector3,
  lookupCache: TemporalLookupCache,
  parentLookupCache: TemporalLookupCache,
) {
  const timeMs = clockRuntime.getTimeMs();
  if (!resolveGeneralTargetFrame(bodyId, timeMs, out, lookupCache, parentLookupCache)) return false;
  if (viewMode === 'didactic') {
    const parentId = Object.keys(PLANET_MOONS).find(id => PLANET_MOONS[id].includes(bodyId));
    const config = getPlanetConfig(bodyId);
    const parentConfig = parentId ? getPlanetConfig(parentId) : null;
    if (parentId && config && parentConfig && resolveGeneralTargetFrame(parentId, timeMs, parentPosition, parentLookupCache, parentLookupCache)) {
      const scale = getMoonOrbitScale(parentId, parentConfig.bodyClass, config.meanDistanceAU * 149_597_870.7, viewMode);
      out.sub(parentPosition).multiplyScalar(scale).add(parentPosition);
    }
  }
  return true;
}

function runTravelStep(
  v1: THREE.Vector3,
  v2: THREE.Vector3,
  v3: THREE.Vector3,
  parentPosition: THREE.Vector3,
  lookupCache: TemporalLookupCache,
  parentLookupCache: TemporalLookupCache,
) {
  const solarStore = useSolarStore.getState();
  const { originStartKm, originTargetKm, travelStartMs, travelDurationMs, followTargetId } = solarStore;
  const now = performance.now();

  const elapsed = now - travelStartMs;
  let t = travelDurationMs > 0 ? THREE.MathUtils.clamp(elapsed / travelDurationMs, 0, 1) : 1;
  t = smootherstep(t);

  v1.set(originStartKm.x, originStartKm.y, originStartKm.z);
  v2.set(originTargetKm.x, originTargetKm.y, originTargetKm.z);
  // Playback may move the destination during a multi-second flight. Finish at
  // the same sampled position the body will use, rather than an old endpoint.
  if (followTargetId) {
    if (!resolveNavigationTarget(followTargetId, solarStore.viewMode, v2, parentPosition, lookupCache, parentLookupCache)) {
      v2.set(originTargetKm.x, originTargetKm.y, originTargetKm.z);
    }
  }
  v3.lerpVectors(v1, v2, t);

  if (!isRenderOriginNearTarget(solarStore.renderOrigin, v3, 0.000001)) {
    solarStore.setRenderOrigin({ x: v3.x, y: v3.y, z: v3.z }, 'custom');
  }

  if (t >= 1) {
    if (followTargetId) {
      solarStore.setFollowTarget(followTargetId);
    } else {
      solarStore.stopOriginNavigation();
      if (originTargetKm.x === 0 && originTargetKm.y === 0 && originTargetKm.z === 0) {
        solarStore.setCameraFocusBody('10');
      }
    }
  }
}

function runFollowStep(
  followTargetId: string,
  outAbsPos: THREE.Vector3,
  parentPosition: THREE.Vector3,
  lookupCache: TemporalLookupCache,
  parentLookupCache: TemporalLookupCache
) {
  const success = resolveNavigationTarget(
    followTargetId,
    useSolarStore.getState().viewMode,
    outAbsPos,
    parentPosition,
    lookupCache,
    parentLookupCache
  );

  if (success) {
    const solarStore = useSolarStore.getState();
    const authoritativePosKm = { x: outAbsPos.x, y: outAbsPos.y, z: outAbsPos.z };
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
    absPos: new THREE.Vector3(),
    parentPos: new THREE.Vector3(),
    focusCenter: new THREE.Vector3(),
  });
  const followLookupCacheRef = useRef(createTemporalLookupCache());
  const followParentLookupCacheRef = useRef(createTemporalLookupCache());
  const zoomRef = useRef<{ start: number; from: number; to: number; duration: number } | null>(null);
  const focusScaleRef = useRef<{ bodyId: string; mode: string; radius: number } | null>(null);

  useEffect(() => {
    const ctrl = controls as unknown as OrbitControlsLike | null;
    const cancelAutomaticZoom = () => { zoomRef.current = null; };
    ctrl?.addEventListener?.('start', cancelAutomaticZoom);
    return () => ctrl?.removeEventListener?.('start', cancelAutomaticZoom);
  }, [controls]);

  // Animation frame loop
  useFrame(() => {
    let solarStore = useSolarStore.getState();
    const { v1, v2, v3, absPos, parentPos, focusCenter } = pool.current;
    focusCenter.set(0, 0, 0);
    let { cameraNavMode, followTargetId } = solarStore;

    if (cameraNavMode === 'travel') {
      runTravelStep(v1, v2, v3, parentPos, followLookupCacheRef.current, followParentLookupCacheRef.current);
    } 
    else if (cameraNavMode === 'follow' && followTargetId) {
      runFollowStep(followTargetId, absPos, parentPos, followLookupCacheRef.current, followParentLookupCacheRef.current);
    }

    // Travel may have completed and established a different origin/body in this
    // callback. Apply its clearance now rather than one visible frame later.
    solarStore = useSolarStore.getState();
    ({ cameraNavMode, followTargetId } = solarStore);

    let focusBodyId = cameraNavMode === 'idle' ? solarStore.cameraFocusBodyId : followTargetId;
    let framing = focusBodyId ? getBodyCameraFraming(focusBodyId, solarStore.viewMode, camera.near) : null;
    const previous = focusScaleRef.current;
    if (framing && focusBodyId && cameraNavMode === 'idle') {
      // Stopping playback tracking freezes the origin, not the scientific body.
      // Retain clearance while it is still near that origin, then release the
      // stale identity if playback or a seek takes it outside the close-up.
      const previousMode = previous?.bodyId === focusBodyId ? previous.mode as ViewMode : solarStore.viewMode;
      const previousFraming = getBodyCameraFraming(focusBodyId, previousMode, camera.near)!;
      if (resolveNavigationTarget(focusBodyId, previousMode, absPos, parentPos, followLookupCacheRef.current, followParentLookupCacheRef.current)) {
        v1.set(solarStore.renderOrigin.x, solarStore.renderOrigin.y, solarStore.renderOrigin.z);
        focusCenter.copy(absPos).sub(v1).multiplyScalar(KM_TO_UNIT);
        if (absPos.distanceTo(v1) * KM_TO_UNIT > previousFraming.distance) {
          solarStore.setCameraFocusBody(null);
          focusBodyId = null;
          framing = null;
        } else if (previousMode !== solarStore.viewMode && getPlanetConfig(focusBodyId)?.bodyClass === 'MOON') {
          // A didactic moon's orbit also changes scale. Keep the new visual
          // centre at the origin even though continuous tracking is stopped.
          if (resolveNavigationTarget(focusBodyId, solarStore.viewMode, absPos, parentPos, followLookupCacheRef.current, followParentLookupCacheRef.current)) {
            solarStore.setRenderOrigin({ x: absPos.x, y: absPos.y, z: absPos.z }, 'selected_body');
            focusCenter.set(0, 0, 0);
          }
        }
      }
    }
    if (framing && focusBodyId) {
      if (previous?.bodyId === focusBodyId && previous.mode !== solarStore.viewMode && focusBodyId !== '10') {
        // Mesh radii change atomically with view mode. Apply the same ratio to
        // camera distance in this frame so the body keeps its projected size.
        const ratio = framing.radius / previous.radius;
        camera.position.multiplyScalar(ratio);
        if (zoomRef.current) {
          zoomRef.current.from *= ratio;
          zoomRef.current.to *= ratio;
        }
      }
      focusScaleRef.current = { bodyId: focusBodyId, mode: solarStore.viewMode, radius: framing.radius };
    } else {
      focusScaleRef.current = null;
    }

    const zoom = zoomRef.current;
    if (zoom) {
      const progress = THREE.MathUtils.clamp((performance.now() - zoom.start) / zoom.duration, 0, 1);
      // Logarithmic interpolation avoids spending the entire journey far away
      // when traveling between million-kilometre and moon-surface scales.
      const distance = Math.exp(THREE.MathUtils.lerp(Math.log(zoom.from), Math.log(zoom.to), smootherstep(progress)));
      if (camera.position.lengthSq() === 0) camera.position.set(0, 0, distance);
      else camera.position.setLength(distance);
      if (progress === 1) zoomRef.current = null;
    }
    if (framing) {
      // A stopped origin can remain close to a moving planet without coinciding
      // with its centre. Clearance belongs to that actual centre, not (0,0,0).
      v2.copy(camera.position).sub(focusCenter);
      if (v2.length() < framing.minDistance) {
        if (v2.lengthSq() === 0) v2.set(0, 0, 1);
        camera.position.copy(focusCenter).add(v2.setLength(framing.minDistance));
        // OrbitControls still enforces a radius around the origin at priority -1.
        // Keep its next clamp from pushing the camera back into the offset body.
        if (camera.position.length() < framing.minDistance) {
          if (camera.position.lengthSq() === 0) camera.position.set(0, 0, 1);
          camera.position.setLength(focusCenter.length() + framing.minDistance);
        }
      }
    }
    enforceControlsTarget(controls);
  }, FRAME_PRIORITIES.ORIGIN);

  const focusOn = useCallback((
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
    const nowMs = performance.now();
    solarStore.startOriginTravel(targetPositionKm, durationMs, nowMs, targetId ?? null);

    const framing = targetId ? getBodyCameraFraming(targetId, solarStore.viewMode, camera.near) : null;
    const framingDistance = framing?.distance ?? (radiusKm
      ? Math.max(CAMERA_CONFIG.MIN_FOCUS_OFFSET, radiusKm * KM_TO_UNIT * CAMERA_CONFIG.FOCUS_RADIUS_MULTIPLIER)
      : null);
    if (framingDistance) {
      zoomRef.current = { start: nowMs, from: Math.max(camera.position.length(), CAMERA_CONFIG.MIN_FOCUS_OFFSET), to: framingDistance, duration: durationMs };
      focusScaleRef.current = framing && targetId ? { bodyId: targetId, mode: solarStore.viewMode, radius: framing.radius } : null;
    }
  }, [camera]);

  const stopTracking = useCallback(() => {
    zoomRef.current = null;
    useSolarStore.getState().stopOriginNavigation();
  }, []);

  const resetCamera = () => {
    zoomRef.current = null;
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
