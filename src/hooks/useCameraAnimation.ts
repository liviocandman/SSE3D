/**
 * useCameraAnimation Hook
 * Provides smooth camera animation to focus on celestial bodies
 */

'use client';

import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

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
  focusOn: (targetPosition: { x: number; y: number; z: number }, radius?: number) => void;
  /** Reset camera to default position */
  resetCamera: () => void;
}

// --- Constants ---

const DEFAULT_DURATION = 1.5; // seconds
const DEFAULT_OFFSET_DISTANCE = 80; // units from target (increased to avoid zooming inside planets)
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 50, 150);
const DEFAULT_LOOK_AT = new THREE.Vector3(0, 0, 0);

// Smooth easing function (ease-out cubic)
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

// --- Hook ---

export function useCameraAnimation(
  options: UseCameraAnimationOptions = {}
): UseCameraAnimationReturn {
  const {
    duration = DEFAULT_DURATION,
    easing = easeOutCubic,
    offsetDistance = DEFAULT_OFFSET_DISTANCE,
  } = options;

  const { camera, controls } = useThree();

  const isAnimatingRef = useRef(false);
  const animationProgressRef = useRef(0);
  const startPositionRef = useRef(new THREE.Vector3());
  const startLookAtRef = useRef(new THREE.Vector3(0, 0, 0)); // Track starting lookAt
  const targetRef = useRef<CameraTarget | null>(null);

  // Animation frame loop
  useFrame((_, delta) => {
    if (!isAnimatingRef.current || !targetRef.current) return;

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
      t
    );

    // Interpolate the lookAt target (from Sun to planet)
    const currentLookAt = new THREE.Vector3().lerpVectors(
      startLookAtRef.current,
      targetRef.current.lookAt,
      t
    );

    // Update OrbitControls target (this is the key fix!)
    if (controls && 'target' in controls) {
      (controls.target as THREE.Vector3).copy(currentLookAt);
      (controls as unknown as { update: () => void }).update();
    }

    camera.lookAt(currentLookAt);
  });

  const focusOn = (targetPosition: { x: number; y: number; z: number }, radius?: number) => {
    const target = new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z);

    // Calculate offset distance based on planet radius
    // Use 3x radius for nice framing, minimum 0.03 units for tiny rocky planets
    const dynamicOffset = radius ? Math.max(0.03, radius * 3) : offsetDistance;

    console.log(`[CameraAnimation] Received radius: ${radius}, calculated offset: ${dynamicOffset}`);

    // Calculate camera position: place camera at a distance from the planet
    // looking at the planet from the current camera direction
    const currentCameraDir = camera.position.clone().normalize();

    // Position camera offset from the target planet
    const offset = currentCameraDir.multiplyScalar(dynamicOffset);
    offset.y = Math.max(offset.y, dynamicOffset * 0.3); // Ensure some height above

    const cameraTargetPosition = target.clone().add(offset);

    // Store animation state
    startPositionRef.current.copy(camera.position);

    // Capture current lookAt target (from OrbitControls or default origin)
    if (controls && 'target' in controls) {
      startLookAtRef.current.copy(controls.target as THREE.Vector3);
    } else {
      startLookAtRef.current.set(0, 0, 0);
    }

    targetRef.current = {
      position: cameraTargetPosition,
      lookAt: target, // Camera looks AT the planet, not the Sun
    };
    animationProgressRef.current = 0;
    isAnimatingRef.current = true;

    console.log(`[CameraAnimation] Focusing on:`, targetPosition, 'Camera will go to:', cameraTargetPosition.toArray());
  };

  const resetCamera = () => {
    startPositionRef.current.copy(camera.position);
    targetRef.current = {
      position: DEFAULT_CAMERA_POSITION.clone(),
      lookAt: DEFAULT_LOOK_AT.clone(),
    };
    animationProgressRef.current = 0;
    isAnimatingRef.current = true;

    console.log('[CameraAnimation] Resetting to default position');
  };

  return {
    focusOn,
    resetCamera,
  };
}

// --- Standalone Component for Scene Integration ---
// This component should be placed inside the Canvas to access R3F context

interface CameraControllerProps {
  targetPosition?: { x: number; y: number; z: number } | null;
  targetRadius?: number;
}

export function CameraController({
  targetPosition,
  targetRadius,
}: CameraControllerProps) {
  const { focusOn, resetCamera } = useCameraAnimation();
  const prevTargetRef = useRef<{ x: number; y: number; z: number } | null>(null);

  useEffect(() => {
    // Check if target changed
    const targetChanged =
      targetPosition !== prevTargetRef.current &&
      (targetPosition?.x !== prevTargetRef.current?.x ||
       targetPosition?.y !== prevTargetRef.current?.y ||
       targetPosition?.z !== prevTargetRef.current?.z);

    if (targetChanged) {
      if (targetPosition) {
        focusOn(targetPosition, targetRadius);
      } else {
        resetCamera();
      }
      prevTargetRef.current = targetPosition ?? null;
    }
  }, [targetPosition, targetRadius, focusOn, resetCamera]);

  return null; // This is a logic-only component
}
