/**
 * useCameraAnimation Hook
 * Provides smooth camera animation to focus on celestial bodies
 */

"use client";

import { useRef, useEffect } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// --- Types ---

interface CameraTarget {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
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
  /** Reset camera to default position */
  resetCamera: () => void;
}

// --- Constants ---

const DEFAULT_DURATION = 1.5; // seconds
const DEFAULT_OFFSET_DISTANCE = 80; // units from target
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 50, 150);
const DEFAULT_LOOK_AT = new THREE.Vector3(0, 0, 0);
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

  // Tracking
  const targetObjectNameRef = useRef<string | null>(null);
  const lastTargetPosRef = useRef(new THREE.Vector3());

  // Animation frame loop
  useFrame((_, delta) => {
    const movementDelta = new THREE.Vector3(0, 0, 0);

    // If tracking a moving object, calculate its movement delta
    if (targetObjectNameRef.current) {
      const obj = scene.getObjectByName(targetObjectNameRef.current);
      if (obj) {
        const currentWorldPos = new THREE.Vector3();
        obj.getWorldPosition(currentWorldPos);

        movementDelta.subVectors(currentWorldPos, lastTargetPosRef.current);
        lastTargetPosRef.current.copy(currentWorldPos);

        // Shift destination target continuously
        if (targetRef.current && isAnimatingRef.current) {
          targetRef.current.lookAt.copy(currentWorldPos);
          targetRef.current.position.add(movementDelta);
        }
      }
    }

    if (isAnimatingRef.current && targetRef.current) {
      // Update progress
      animationProgressRef.current += delta / duration;

      if (animationProgressRef.current >= 1) {
        // Animation complete
        animationProgressRef.current = 1;
        isAnimatingRef.current = false;
      }

      const t = easing(animationProgressRef.current);

      // Interpolate camera position
      camera.position.lerpVectors(
        startPositionRef.current,
        targetRef.current.position,
        t,
      );

      // Interpolate the lookAt target (from Sun to planet)
      const currentLookAt = new THREE.Vector3().lerpVectors(
        startLookAtRef.current,
        targetRef.current.lookAt,
        t,
      );

      // Update OrbitControls target
      if (controls && "target" in controls) {
        (controls.target as THREE.Vector3).copy(currentLookAt);
        (controls as unknown as { update: () => void }).update();
      }

      camera.lookAt(currentLookAt);
    } else if (!isAnimatingRef.current && movementDelta.lengthSq() > 0) {
      // Animation finished, just lock exactly onto the moving target!
      // Apply movement delta to camera to follow the planet while allowing OrbitControls to work
      camera.position.add(movementDelta);

      if (controls && "target" in controls) {
        (controls.target as THREE.Vector3).add(movementDelta);
        (controls as unknown as { update: () => void }).update();
      }
    }
  });

  const focusOn = (
    targetPosition: { x: number; y: number; z: number },
    radius?: number,
    targetName?: string,
  ) => {
    const target = new THREE.Vector3(
      targetPosition.x,
      targetPosition.y,
      targetPosition.z,
    );

    // If tracking by name, always prefer the exact current world position over the passed static coordinates
    if (targetName) {
      const obj = scene.getObjectByName(targetName);
      if (obj) {
        obj.getWorldPosition(target);
      }
    }

    // Calculate offset distance based on planet radius
    const dynamicOffset = radius ? Math.max(MIN_FOCUS_OFFSET, radius * 3) : offsetDistance;

    // Calculate camera position
    const currentCameraDir = camera.position.clone().normalize();
    const offset = currentCameraDir.multiplyScalar(dynamicOffset);
    offset.y = Math.max(offset.y, dynamicOffset * 0.3);

    const cameraTargetPosition = target.clone().add(offset);

    // Store animation state
    startPositionRef.current.copy(camera.position);

    // Capture current lookAt target
    if (controls && "target" in controls) {
      startLookAtRef.current.copy(controls.target as THREE.Vector3);
    } else {
      startLookAtRef.current.set(0, 0, 0);
    }

    targetRef.current = {
      position: cameraTargetPosition,
      lookAt: target,
    };

    targetObjectNameRef.current = targetName || null;
    lastTargetPosRef.current.copy(target);

    animationProgressRef.current = 0;
    isAnimatingRef.current = true;
  };

  const resetCamera = () => {
    startPositionRef.current.copy(camera.position);
    targetRef.current = {
      position: DEFAULT_CAMERA_POSITION.clone(),
      lookAt: DEFAULT_LOOK_AT.clone(),
    };
    targetObjectNameRef.current = null;
    animationProgressRef.current = 0;
    isAnimatingRef.current = true;
  };

  return {
    focusOn,
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
  const { focusOn, resetCamera } = useCameraAnimation();
  const prevTargetRef = useRef<{ x: number; y: number; z: number } | null>(
    null,
  );

  useEffect(() => {
    // Check if target changed
    const targetChanged =
      targetPosition !== prevTargetRef.current &&
      (targetPosition?.x !== prevTargetRef.current?.x ||
        targetPosition?.y !== prevTargetRef.current?.y ||
        targetPosition?.z !== prevTargetRef.current?.z);

    if (targetChanged) {
      if (targetPosition) {
        focusOn(targetPosition, targetRadius, targetName);
      } else {
        resetCamera();
      }
      prevTargetRef.current = targetPosition ?? null;
    }
  }, [targetPosition, targetRadius, targetName, focusOn, resetCamera]);

  return null;
}
