/**
 * useCameraAnimation Hook
 * Provides smooth, stable camera animation with kinematic constraints and origin smoothing.
 */

"use client";

import { useRef, useEffect } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSolarStore } from "@/store/solarStore";
import { KM_TO_UNIT } from "@/lib/scales";
import { CAMERA_CONFIG } from "@/lib/cameraConfig";

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
    targetPosition: { x: number; y: number; z: number },
    radius?: number,
    targetName?: string,
  ) => void;
  /** Stop tracking/animation */
  stopTracking: () => void;
  /** Reset camera to default position */
  resetCamera: () => void;
}

interface CameraControlsLike {
  target: THREE.Vector3;
  update: () => void;
  addEventListener: (type: "start" | "end", listener: () => void) => void;
  removeEventListener: (type: "start" | "end", listener: () => void) => void;
}

// --- Hook ---

export function useCameraAnimation(
  options: UseCameraAnimationOptions = {},
): UseCameraAnimationReturn {
  const {
    offsetDistance = CAMERA_CONFIG.DEFAULT_OFFSET[2],
  } = options;

  const { camera, controls, scene } = useThree();

  // 1. Unified state for damped control
  const isAnimatingRef = useRef(false);
  const targetObjectNameRef = useRef<string | null>(null);
  const targetRef = useRef<CameraTarget | null>(null);

  // 2. Damping states (relative units)
  const currentPivotUnits = useRef(new THREE.Vector3(0, 0, 0));
  const currentOffsetUnits = useRef(new THREE.Vector3().set(...CAMERA_CONFIG.DEFAULT_OFFSET));

  // 3. Smooth Origin (Phase 2)
  const targetOriginKm = useRef(new THREE.Vector3(0, 0, 0));
  const displayOriginKm = useRef(new THREE.Vector3(0, 0, 0));
  const originInitializedRef = useRef(false);
  const currentLinearVelocityUnits = useRef(new THREE.Vector3());
  const currentLookDirectionRef = useRef(new THREE.Vector3(0, 0, -1));
  const activeTravelMaxSpeedRef = useRef(CAMERA_CONFIG.MAX_LINEAR_SPEED);
  const activeTravelMaxAccelRef = useRef(CAMERA_CONFIG.MAX_LINEAR_ACCEL);
  const lastOriginApplyTimeRef = useRef(0);

  // 4. Zero-GC Vector Pool
  const pool = useRef({
    v1: new THREE.Vector3(),
    v2: new THREE.Vector3(),
    v3: new THREE.Vector3(),
    v4: new THREE.Vector3(),
    v5: new THREE.Vector3(),
    v6: new THREE.Vector3(),
    worldPos: new THREE.Vector3(),
    prevPos: new THREE.Vector3(),
  });

  // 5. Manual Interaction State
  const isUserDraggingRef = useRef(false);

  useEffect(() => {
    if (!controls) return;
    const ctrl = controls as unknown as CameraControlsLike;
    
    const onStart = () => {
      isUserDraggingRef.current = true;
      // User intent wins: cancel auto-travel/lock immediately.
      isAnimatingRef.current = false;
      targetRef.current = null;
      currentLinearVelocityUnits.current.set(0, 0, 0);
    };
    const onEnd = () => { isUserDraggingRef.current = false; };

    ctrl.addEventListener('start', onStart);
    ctrl.addEventListener('end', onEnd);
    return () => {
      ctrl.removeEventListener('start', onStart);
      ctrl.removeEventListener('end', onEnd);
    };
  }, [controls]);

  const setRenderOrigin = useSolarStore(state => state.setRenderOrigin);

  // Animation frame loop
  useFrame((state, delta) => {
    if (delta <= 0) return;
    const dt = Math.min(delta, 0.05);

    const solarState = useSolarStore.getState();
    const { v1, v2, v3, v4, v5, v6, worldPos, prevPos } = pool.current;

    if (!originInitializedRef.current) {
      targetOriginKm.current.set(solarState.renderOrigin.x, solarState.renderOrigin.y, solarState.renderOrigin.z);
      displayOriginKm.current.copy(targetOriginKm.current);
      originInitializedRef.current = true;
    }

    // A. Resolve Target Truth (Absolute KM)
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

    const hasAutoIntent = hasTarget || isAnimatingRef.current || targetRef.current !== null;

    // If camera is not being auto-driven, keep internal state synced with user-driven controls
    // and avoid overriding OrbitControls behavior.
    if (!hasAutoIntent) {
      if (controls && "target" in controls) {
        currentPivotUnits.current.copy((controls.target as THREE.Vector3));
      }
      v3.subVectors(camera.position, currentPivotUnits.current);
      currentOffsetUnits.current.copy(v3);
      currentLinearVelocityUnits.current.set(0, 0, 0);

      // Keep origin trackers coherent so next autofocus doesn't "kick"
      targetOriginKm.current.copy(v1);
      displayOriginKm.current.copy(v1);
      return;
    }

    // B. Handle Origin Hysteresis & Smooth Rebase (Phase 2)
    let didShiftOrigin = false;
    if (hasTarget) {
      const distToTargetOriginKm = v2.distanceTo(targetOriginKm.current);
      
      // Update target origin if target moves beyond hysteresis
      // (Removed isAnimatingRef.current bypass to maintain stability even during travel)
      if (distToTargetOriginKm > CAMERA_CONFIG.ORIGIN_HYSTERESIS_KM) {
        targetOriginKm.current.copy(v2);
      }

      // Smoothly converge display origin to target origin (Zero "kick" visual)
      // derive damping from ms config: damping = 1 / (ms / 1000) => 1 / 0.3 = 3.33
      const originDamp = 1000 / CAMERA_CONFIG.ORIGIN_SMOOTHING_MS; 
      
      displayOriginKm.current.x = THREE.MathUtils.damp(displayOriginKm.current.x, targetOriginKm.current.x, originDamp, dt);
      displayOriginKm.current.y = THREE.MathUtils.damp(displayOriginKm.current.y, targetOriginKm.current.y, originDamp, dt);
      displayOriginKm.current.z = THREE.MathUtils.damp(displayOriginKm.current.z, targetOriginKm.current.z, originDamp, dt);

      const displayToTargetKm = displayOriginKm.current.distanceTo(targetOriginKm.current);
      if (displayToTargetKm > CAMERA_CONFIG.ORIGIN_HARD_SNAP_KM) {
        displayOriginKm.current.copy(targetOriginKm.current);
      }

      // Apply smoothed origin to store
      const originDriftKm = v1.distanceTo(displayOriginKm.current);
      const now = state.clock.elapsedTime;
      const minOriginApplyInterval = 1 / CAMERA_CONFIG.ORIGIN_MAX_UPDATE_HZ;
      const shouldApplyOrigin =
        originDriftKm >= CAMERA_CONFIG.ORIGIN_APPLY_TOLERANCE_KM &&
        (
          (now - lastOriginApplyTimeRef.current) >= minOriginApplyInterval ||
          originDriftKm >= CAMERA_CONFIG.ORIGIN_HARD_SNAP_KM
        );

      if (shouldApplyOrigin) {
        setRenderOrigin(
          {
            x: displayOriginKm.current.x,
            y: displayOriginKm.current.y,
            z: displayOriginKm.current.z,
          },
          'custom'
        );
        lastOriginApplyTimeRef.current = now;
        
        // COMPENSATE: visual state shift
        v3.set(v1.x - displayOriginKm.current.x, v1.y - displayOriginKm.current.y, v1.z - displayOriginKm.current.z)
          .multiplyScalar(KM_TO_UNIT);
        
        currentPivotUnits.current.add(v3);
        didShiftOrigin = true;
      }
    }

    const isFollowMode = hasTarget && !isAnimatingRef.current && targetRef.current === null;
    if (isFollowMode) {
      if (didShiftOrigin) {
        camera.position.add(v3);
        if (controls && "target" in controls) {
          (controls.target as THREE.Vector3).add(v3);
          (controls as unknown as { update: () => void }).update();
        }
      }

      if (controls && "target" in controls) {
        currentPivotUnits.current.copy((controls.target as THREE.Vector3));
      }
      v5.subVectors(camera.position, currentPivotUnits.current);
      currentOffsetUnits.current.copy(v5);
      currentLinearVelocityUnits.current.set(0, 0, 0);
      return;
    }

    // C. Damped Spring Simulation & Kinematics (Phase 2)
    const idealPivot = v4.set(0, 0, 0);
    const idealOffset = targetRef.current?.localOffsetUnits || currentOffsetUnits.current;

    const pDamp = isUserDraggingRef.current ? CAMERA_CONFIG.DAMPING_INTERACTION : CAMERA_CONFIG.DAMPING_PIVOT;
    const oDampFactor = isAnimatingRef.current ? 4 : CAMERA_CONFIG.DAMPING_OFFSET;
    const maxLinearSpeed = isAnimatingRef.current ? activeTravelMaxSpeedRef.current : CAMERA_CONFIG.MAX_LINEAR_SPEED;
    const maxLinearAccel = isAnimatingRef.current ? activeTravelMaxAccelRef.current : CAMERA_CONFIG.MAX_LINEAR_ACCEL;

    // Capture previous local position for kinematics
    prevPos.copy(camera.position);

    // 1. Pivot Update (with Dead-zone)
    const pivotErrorSq = currentPivotUnits.current.distanceToSquared(idealPivot);
    if (pivotErrorSq > CAMERA_CONFIG.DEAD_ZONE_UNITS * CAMERA_CONFIG.DEAD_ZONE_UNITS || isAnimatingRef.current) {
      currentPivotUnits.current.x = THREE.MathUtils.damp(currentPivotUnits.current.x, idealPivot.x, pDamp, dt);
      currentPivotUnits.current.y = THREE.MathUtils.damp(currentPivotUnits.current.y, idealPivot.y, pDamp, dt);
      currentPivotUnits.current.z = THREE.MathUtils.damp(currentPivotUnits.current.z, idealPivot.z, pDamp, dt);
    }

    // 2. Offset Update
    currentOffsetUnits.current.x = THREE.MathUtils.damp(currentOffsetUnits.current.x, idealOffset.x, oDampFactor, dt);
    currentOffsetUnits.current.y = THREE.MathUtils.damp(currentOffsetUnits.current.y, idealOffset.y, oDampFactor, dt);
    currentOffsetUnits.current.z = THREE.MathUtils.damp(currentOffsetUnits.current.z, idealOffset.z, oDampFactor, dt);

    // If user is actively dragging, don't fight OrbitControls.
    if (isUserDraggingRef.current && !isAnimatingRef.current) {
      if (controls && "target" in controls) {
        currentPivotUnits.current.copy((controls.target as THREE.Vector3));
      }
      v3.subVectors(camera.position, currentPivotUnits.current);
      currentOffsetUnits.current.copy(v3);
      currentLinearVelocityUnits.current.set(0, 0, 0);
      return;
    }

    // 3. Final Position & Kinematic Clamping (Phase 2)
    v1.addVectors(currentPivotUnits.current, currentOffsetUnits.current);

    // Linear velocity + acceleration clamp
    const desiredVelocity = v5.subVectors(v1, prevPos).multiplyScalar(1 / dt);
    const velocityDelta = v6.subVectors(desiredVelocity, currentLinearVelocityUnits.current);
    const maxVelocityDelta = maxLinearAccel * dt;
    if (velocityDelta.lengthSq() > maxVelocityDelta * maxVelocityDelta && maxVelocityDelta > 0) {
      velocityDelta.setLength(maxVelocityDelta);
      desiredVelocity.copy(currentLinearVelocityUnits.current).add(velocityDelta);
    }

    if (desiredVelocity.lengthSq() > maxLinearSpeed * maxLinearSpeed) {
      desiredVelocity.setLength(maxLinearSpeed);
    }

    v1.copy(prevPos).addScaledVector(desiredVelocity, dt);
    currentLinearVelocityUnits.current.copy(desiredVelocity);

    // Reconcile internal state after kinematic clamp to avoid elastic artifacts
    v3.subVectors(v1, currentPivotUnits.current);
    currentOffsetUnits.current.copy(v3);

    camera.position.copy(v1);

    // E. Apply to Controls
    if (controls && "target" in controls) {
      (controls.target as THREE.Vector3).copy(currentPivotUnits.current);
      (controls as unknown as { update: () => void }).update();
    }

    // Angular speed clamp
    const desiredLookDirection = v2.subVectors(currentPivotUnits.current, camera.position);
    if (desiredLookDirection.lengthSq() > 1e-16) {
      desiredLookDirection.normalize();
      const maxAngle = CAMERA_CONFIG.MAX_ANGULAR_SPEED * dt;
      const currentLookDirection = currentLookDirectionRef.current;
      const angle = currentLookDirection.angleTo(desiredLookDirection);
      if (angle > 1e-6) {
        const t = Math.min(1, maxAngle / angle);
        currentLookDirection.lerp(desiredLookDirection, t).normalize();
      } else {
        currentLookDirection.copy(desiredLookDirection);
      }
      camera.lookAt(v6.copy(camera.position).add(currentLookDirectionRef.current));
    } else {
      camera.lookAt(currentPivotUnits.current);
    }

    // Check convergence
    if (isAnimatingRef.current) {
      const offsetDistSq = currentOffsetUnits.current.distanceToSquared(idealOffset);
      if (pivotErrorSq < 1e-10 && offsetDistSq < 1e-10) {
        isAnimatingRef.current = false;
        currentLinearVelocityUnits.current.set(0, 0, 0);
        activeTravelMaxSpeedRef.current = CAMERA_CONFIG.MAX_LINEAR_SPEED;
        activeTravelMaxAccelRef.current = CAMERA_CONFIG.MAX_LINEAR_ACCEL;
        // Release framing lock after travel so OrbitControls can freely zoom/rotate.
        // Keep target-name tracking so follow mode remains active during time travel.
        targetRef.current = null;
      }
    }
  });

  const focusOn = (
    targetPosition: { x: number; y: number; z: number },
    radius?: number,
    targetName?: string,
  ) => {
    const solarState = useSolarStore.getState();
    const { v1, v2, v3, v4, worldPos } = pool.current;

    v1.set(solarState.renderOrigin.x, solarState.renderOrigin.y, solarState.renderOrigin.z);

    // 1. Resolve Target Absolute Km
    v2.set(targetPosition.x, targetPosition.y, targetPosition.z);
    if (targetName) {
      const obj = scene.getObjectByName(targetName);
      if (obj) {
        obj.getWorldPosition(worldPos);
        v2.set(
          worldPos.x / KM_TO_UNIT + v1.x,
          worldPos.y / KM_TO_UNIT + v1.y,
          worldPos.z / KM_TO_UNIT + v1.z
        );
      }
    }

    // 2. Set new target origin (Wait for smoothing to catch up)
    targetOriginKm.current.copy(v2);

    // 3. Setup relative targets
    const dynamicOffset = radius ? Math.max(CAMERA_CONFIG.MIN_FOCUS_OFFSET, radius * CAMERA_CONFIG.FOCUS_RADIUS_MULTIPLIER) : offsetDistance;
    v3.set(0, dynamicOffset * 0.3, dynamicOffset);

    // Adaptive travel profile: keeps perceived duration more constant across short/long jumps.
    const currentLocalPos = camera.position;
    const targetLocalPos = v4.copy(v3); // target pivot is always (0,0,0) in local frame
    const travelDistance = currentLocalPos.distanceTo(targetLocalPos);
    const targetDuration = Math.max(0.1, CAMERA_CONFIG.TRAVEL_TARGET_DURATION_S);
    const adaptiveSpeed = THREE.MathUtils.clamp(
      travelDistance / targetDuration,
      CAMERA_CONFIG.TRAVEL_MIN_SPEED,
      CAMERA_CONFIG.TRAVEL_MAX_SPEED
    );
    activeTravelMaxSpeedRef.current = adaptiveSpeed;
    activeTravelMaxAccelRef.current = Math.max(CAMERA_CONFIG.MAX_LINEAR_ACCEL, adaptiveSpeed * 2.5);

    targetRef.current = {
      localOffsetUnits: v3.clone(),
    };

    targetObjectNameRef.current = targetName || null;
    isAnimatingRef.current = true;
  };

  const resetCamera = () => {
    targetOriginKm.current.set(0, 0, 0);
    displayOriginKm.current.set(0, 0, 0);
    
    targetRef.current = {
      localOffsetUnits: new THREE.Vector3().set(...CAMERA_CONFIG.DEFAULT_OFFSET),
    };
    targetObjectNameRef.current = null;
    isAnimatingRef.current = true;
    currentLinearVelocityUnits.current.set(0, 0, 0);
    activeTravelMaxSpeedRef.current = CAMERA_CONFIG.MAX_LINEAR_SPEED;
    activeTravelMaxAccelRef.current = CAMERA_CONFIG.MAX_LINEAR_ACCEL;
  };

  const stopTracking = () => {
    targetRef.current = null;
    targetObjectNameRef.current = null;
    isAnimatingRef.current = false;
    currentLinearVelocityUnits.current.set(0, 0, 0);
    activeTravelMaxSpeedRef.current = CAMERA_CONFIG.MAX_LINEAR_SPEED;
    activeTravelMaxAccelRef.current = CAMERA_CONFIG.MAX_LINEAR_ACCEL;
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
