/**
 * useCameraAnimation Hook
 * Provides smooth camera animation to focus on celestial bodies
 */

"use client";

import { useRef, useEffect } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSolarStore } from "@/store/solarStore";
import { KM_TO_UNIT } from "@/lib/scales";
import { isRenderOriginNearTarget } from "@/lib/renderFrame";

// --- Types ---

interface CameraTarget {
  /** Desired camera offset relative to target in units */
  localOffsetUnits: THREE.Vector3;
}

interface UseCameraAnimationOptions {
  /** Animation duration in seconds */
  duration?: number;
  /** Easing function */
  easing?: (t: number) => number;
  /** Offset distance from target */
  offsetDistance?: number;
}

interface UseCameraAnimationReturn {
  /** Animate camera to look at a position */
  focusOn: (
    targetPosition: { x: number; y: number; z: number },
    radius?: number,
    targetName?: string,
  ) => void;
  /** Stop tracking/animation without snapping back to the default camera */
  stopTracking: () => void;
  /** Reset camera to default position */
  resetCamera: () => void;
}

// --- Constants ---

const DEFAULT_DURATION = 1.5; // seconds
const DEFAULT_OFFSET_DISTANCE = 80; // units from target
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 50, 150);
const MIN_FOCUS_OFFSET = 0.00005;

// Smooth easing function (ease-out cubic)
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

// --- Hook ---

export function useCameraAnimation(
  options: UseCameraAnimationOptions = {},
): UseCameraAnimationReturn {
  const {
    duration = DEFAULT_DURATION,
    easing = easeOutCubic,
    offsetDistance = DEFAULT_OFFSET_DISTANCE,
  } = options;

  const { camera, controls, scene } = useThree();

  const isAnimatingRef = useRef(false);
  const animationProgressRef = useRef(0);
  const startPositionRef = useRef(new THREE.Vector3());
  const startLookAtRef = useRef(new THREE.Vector3(0, 0, 0)); // Track starting lookAt
  const targetRef = useRef<CameraTarget | null>(null);

  const worldPositionRef = useRef(new THREE.Vector3());
  const targetObjectNameRef = useRef<string | null>(null);

  const setRenderOrigin = useSolarStore(state => state.setRenderOrigin);

  // Animation frame loop
  useFrame((_, delta) => {
    const solarState = useSolarStore.getState();
    const renderOrigin = new THREE.Vector3(
      solarState.renderOrigin.x,
      solarState.renderOrigin.y,
      solarState.renderOrigin.z
    );

    // 1. Handle Tracking / Origin Updates
    if (targetObjectNameRef.current) {
      const obj = scene.getObjectByName(targetObjectNameRef.current);
      if (obj) {
        const worldPos = obj.getWorldPosition(worldPositionRef.current);
        const absolutePosKm = new THREE.Vector3(
          renderOrigin.x + worldPos.x / KM_TO_UNIT,
          renderOrigin.y + worldPos.y / KM_TO_UNIT,
          renderOrigin.z + worldPos.z / KM_TO_UNIT
        );

        if (!isRenderOriginNearTarget(solarState.renderOrigin, absolutePosKm, 0.001)) {
          setRenderOrigin(absolutePosKm, 'custom');
        }

        if (!isAnimatingRef.current) {
          if (controls && "target" in controls) {
            (controls.target as THREE.Vector3).set(0, 0, 0);
            (controls as unknown as { update: () => void }).update();
          }
        }
      }
    }

    // 2. Handle Active Animation
    if (isAnimatingRef.current && targetRef.current) {
      animationProgressRef.current += delta / duration;

      if (animationProgressRef.current >= 1) {
        animationProgressRef.current = 1;
        isAnimatingRef.current = false;
      }

      const t = easing(animationProgressRef.current);

      camera.position.lerpVectors(
        startPositionRef.current,
        targetRef.current.localOffsetUnits,
        t
      );

      const currentLocalLookAt = new THREE.Vector3().lerpVectors(
        startLookAtRef.current,
        new THREE.Vector3(0, 0, 0),
        t
      );

      if (controls && "target" in controls) {
        (controls.target as THREE.Vector3).copy(currentLocalLookAt);
        (controls as unknown as { update: () => void }).update();
      }

      camera.lookAt(currentLocalLookAt);
    }
  });

  const focusOn = (
    targetPosition: { x: number; y: number; z: number },
    radius?: number,
    targetName?: string,
  ) => {
    const solarState = useSolarStore.getState();
    const currentOrigin = new THREE.Vector3(
      solarState.renderOrigin.x,
      solarState.renderOrigin.y,
      solarState.renderOrigin.z
    );

    const targetAbsoluteKm = new THREE.Vector3(
      targetPosition.x,
      targetPosition.y,
      targetPosition.z
    );

    if (targetName) {
      const obj = scene.getObjectByName(targetName);
      if (obj) {
        const worldPos = obj.getWorldPosition(worldPositionRef.current);
        targetAbsoluteKm.set(
          worldPos.x / KM_TO_UNIT + currentOrigin.x,
          worldPos.y / KM_TO_UNIT + currentOrigin.y,
          worldPos.z / KM_TO_UNIT + currentOrigin.z
        );
      }
    }

    setRenderOrigin(targetAbsoluteKm, 'selected_body');

    const dynamicOffset = radius ? Math.max(MIN_FOCUS_OFFSET, radius * 3) : offsetDistance;
    const localOffsetUnits = new THREE.Vector3(0, dynamicOffset * 0.3, dynamicOffset);

    const originShiftUnits = new THREE.Vector3()
      .subVectors(currentOrigin, targetAbsoluteKm)
      .multiplyScalar(KM_TO_UNIT);
    
    camera.position.add(originShiftUnits);
    startPositionRef.current.copy(camera.position);

    if (controls && "target" in controls) {
      const oldLocalTarget = (controls.target as THREE.Vector3).clone();
      startLookAtRef.current.copy(oldLocalTarget.add(originShiftUnits));
    } else {
      startLookAtRef.current.copy(originShiftUnits);
    }

    targetRef.current = {
      localOffsetUnits: localOffsetUnits,
    };

    targetObjectNameRef.current = targetName || null;
    animationProgressRef.current = 0;
    isAnimatingRef.current = true;
  };

  const resetCamera = () => {
    const solarState = useSolarStore.getState();
    const currentOrigin = new THREE.Vector3(
      solarState.renderOrigin.x,
      solarState.renderOrigin.y,
      solarState.renderOrigin.z
    );
    const globalOrigin = new THREE.Vector3(0, 0, 0);

    setRenderOrigin(globalOrigin, 'global');

    const originShiftUnits = new THREE.Vector3()
      .subVectors(currentOrigin, globalOrigin)
      .multiplyScalar(KM_TO_UNIT);

    camera.position.add(originShiftUnits);
    startPositionRef.current.copy(camera.position);

    if (controls && "target" in controls) {
       const oldLocalTarget = (controls.target as THREE.Vector3).clone();
       startLookAtRef.current.copy(oldLocalTarget.add(originShiftUnits));
    } else {
       startLookAtRef.current.copy(originShiftUnits);
    }

    targetRef.current = {
      localOffsetUnits: DEFAULT_CAMERA_POSITION.clone(),
    };
    targetObjectNameRef.current = null;
    animationProgressRef.current = 0;
    isAnimatingRef.current = true;
  };

  const stopTracking = () => {
    targetRef.current = null;
    targetObjectNameRef.current = null;
    animationProgressRef.current = 0;
    isAnimatingRef.current = false;
  };

  return {
    focusOn,
    stopTracking,
    resetCamera,
  };
}

// --- Standalone Component for Scene Integration ---

interface CameraControllerProps {
  targetPosition?: { x: number; y: number; z: number } | null;
  targetRadius?: number;
  targetName?: string;
}

export function CameraController({
  targetPosition,
  targetRadius,
  targetName,
}: CameraControllerProps) {
  const { focusOn, stopTracking } = useCameraAnimation();
  const prevTargetRef = useRef<{ x: number; y: number; z: number } | null>(
    null,
  );
  const prevTargetNameRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const targetChanged =
      targetPosition !== prevTargetRef.current &&
      (targetPosition?.x !== prevTargetRef.current?.x ||
        targetPosition?.y !== prevTargetRef.current?.y ||
        targetPosition?.z !== prevTargetRef.current?.z);
    const targetNameChanged = targetName !== prevTargetNameRef.current;

    if (targetPosition) {
      if (targetChanged || targetNameChanged) {
        focusOn(targetPosition, targetRadius, targetName);
        prevTargetRef.current = targetPosition;
        prevTargetNameRef.current = targetName;
      } else {
        prevTargetRef.current = targetPosition;
        prevTargetNameRef.current = targetName;
      }
      return;
    }

    if (prevTargetRef.current || prevTargetNameRef.current) {
      stopTracking();
      prevTargetRef.current = null;
      prevTargetNameRef.current = undefined;
    }
  }, [targetPosition, targetRadius, targetName, focusOn, stopTracking]);

  return null;
}
