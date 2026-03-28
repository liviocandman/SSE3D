"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, ThreeEvent, useLoader } from "@react-three/fiber";
import { Text, Billboard } from "@react-three/drei";
import { TextureLoader } from "three";
import type { Mesh } from "three";
import * as THREE from "three";
import "../../app/globals.css";
import type { ViewMode } from "@/lib/scales";
import { useSolarStore } from "@/store/solarStore";
import type { EphemerisTrajectory } from "@/lib/types";
import { buildTrajectorySegment, sampleTrajectoryAtTime } from "@/lib/trajectoryEngine";
import { calculateRotationStep, calculateAbsoluteRotation } from "@/lib/rotationUtils";

// --- Types ---

interface CelestialBodyProps {
  name: string;
  englishName: string;
  bodyId: string;
  position: [number, number, number];
  trajectory?: EphemerisTrajectory[];
  radius: number;
  textureUrl: string;
  rotationSpeed?: number;
  axialTilt?: number;
  dayLength?: number;
  segments?: number;
  onClick?: (bodyId: string) => void;
  onDoubleClick?: (bodyId: string) => void;
  viewMode?: ViewMode;
  children?: React.ReactNode;
}

// --- Constants ---

const DEFAULT_ROTATION_SPEED = 0.002;
const LABEL_COLOR = "#a3cffe";
const MIN_FONT_SIZE = 2;
const MAX_FONT_SIZE = 100;
const THROTTLE_FRAMES = 10;

// --- Component ---

export function CelestialBody({
  englishName,
  bodyId,
  position: initialPosition,
  trajectory,
  radius,
  textureUrl,
  rotationSpeed,
  axialTilt = 0,
  dayLength,
  segments = 64,
  onClick,
  onDoubleClick,
  viewMode = "didactic",
  children,
}: CelestialBodyProps) {
  const meshRef = useRef<Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  // Use useLoader directly to have access to useLoader.clear() for global cache cleanup
  const texture = useLoader(TextureLoader, textureUrl, (loader) => {
    loader.setCrossOrigin("anonymous");
  });

  const [fontSize, setFontSize] = useState(5);
  const [isHovered, setIsHovered] = useState(false);
  const { camera } = useThree();

  const tempVec = useRef(new THREE.Vector3());
  const isInitializedRef = useRef(false);
  const frameCountRef = useRef(0);
  const fallbackSegments = useMemo(() => {
    if (!trajectory || trajectory.length === 0) return [];
    const segment = buildTrajectorySegment(trajectory);
    return segment ? [segment] : [];
  }, [trajectory]);

  // Dispose of geometry and material on unmount to free GPU memory
  useEffect(() => {
    const mesh = meshRef.current;
    return () => {
      if (mesh) {
        mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => m.dispose());
          } else {
            (mesh.material as THREE.Material).dispose();
          }
        }
      }
    };
  }, []);

  // Animation loop
  useFrame((state, delta) => {
    const solarState = useSolarStore.getState();
    const simTime = solarState.currentTime.getTime();
    const isPlaying = solarState.isPlaying;
    const timeMultiplier = solarState.timeMultiplier;

    // Read segment-aware trajectory first; fallback to initial prop data.
    const segments = solarState.masterTrajectorySegments[bodyId] || fallbackSegments;

    // 1. Interpolate position from trajectory if available
    if (segments.length > 0 && groupRef.current) {
      const SCALE = 1 / 1_000_000;
      const sampled = sampleTrajectoryAtTime(segments, simTime);
      if (sampled) {
        const { x, y, z } = sampled.position;
        const targetPos = tempVec.current.set(x * SCALE, y * SCALE, z * SCALE);

        if (!isInitializedRef.current) {
          // Snap to first valid position to avoid flying from origin
          groupRef.current.position.copy(targetPos);
          isInitializedRef.current = true;
        } else {
          // Use frame-rate independent LERP (approx 0.1 at 60fps)
          const lerpFactor = 1 - Math.exp(-6 * delta);
          groupRef.current.position.lerp(targetPos, lerpFactor);
        }
      }
    } else if (groupRef.current && !isInitializedRef.current) {
      // Fallback: use static prop position once if no trajectory is ready
      groupRef.current.position.set(...initialPosition);
      isInitializedRef.current = true;
    }

    // 2. Planet rotation (Absolute orientation + Optional didactic spin)
    if (meshRef.current) {
      if (viewMode === "realistic" && dayLength !== undefined) {
        // Realistic mode: strictly physical orientation based on timestamp
        meshRef.current.rotation.y = calculateAbsoluteRotation(dayLength, simTime);
      } else {
        // Didactic mode: absolute orientation (boosted) + real-time spin
        // This ensures the planet "jumps" correctly during time travel
        // but still feels "alive" when simulation is paused.

        // 1. Physical base rotation (from dayLength, slightly boosted for visibility)
        const baseRotation = dayLength !== undefined
          ? calculateAbsoluteRotation(dayLength, simTime)
          : 0;

        // 2. Visual "didactic" spin (constant rotation for feedback)
        // Uses state.clock.elapsedTime (real world time)
        const direction = (dayLength !== undefined && dayLength < 0) ? -1 : 1;
        const speed = rotationSpeed ?? DEFAULT_ROTATION_SPEED;
        const visualSpin = state.clock.elapsedTime * speed * 60 * direction;

        // Combine them
        meshRef.current.rotation.y = baseRotation + visualSpin;
      }
    }

    // 3. Throttled calculations for UI/Labels
    frameCountRef.current++;

    // Calculate squared distance (no sqrt, faster) for adaptive throttling
    const currentPos = groupRef.current?.position || tempVec.current.set(initialPosition[0], initialPosition[1], initialPosition[2]);
    const distanceSq = camera.position.distanceToSquared(currentPos);

    // Adaptive throttling: planets further away update labels/markers less frequently
    const throttleInterval = frameCountRef.current < 100
      ? THROTTLE_FRAMES
      : Math.min(30, THROTTLE_FRAMES + Math.floor(distanceSq / 40000));

    if (frameCountRef.current % throttleInterval !== 0) return;

    // Real distance needed for label size and marker opacity (calculated only when throttled)
    const distance = Math.sqrt(distanceSq);

    // --- Adaptive Label Font Size ---
    let newFontSize: number;
    if (distance < 100) {
      newFontSize = 0.5 + (distance / 100) * 1;
    } else if (distance < 6000) {
      newFontSize = 1.5 + ((distance - 100) / 700) * 6.5;
    } else {
      newFontSize = 8 + Math.min(192, ((distance - 6000) / 4200) * 192);
    }
    newFontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, newFontSize));
    if (Math.abs(newFontSize - fontSize) > 0.5) {
      setFontSize(newFontSize);
    }
  });

  // Click handler - show info only (no travel)
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onClick?.(bodyId);
  };

  // Double-click handler - travel to planet
  const handleDoubleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onDoubleClick?.(bodyId);
  };

  // In realistic mode, planets are very small - use a minimum hitbox size for interaction
  const hitboxRadius =
    viewMode === "realistic"
      ? Math.max(5, radius * 500) // At least 2 units, or 100x the tiny radius
      : radius * 1.2; // Slightly larger than visual in didactic

  // Ring size scales with radius
  const ringInnerRadius = radius * 1.15;
  const ringOuterRadius = radius * 1.25;

  // Label color changes on hover
  const labelColor = isHovered ? "#ffffff" : LABEL_COLOR;
  // Label position: above planet when hovered, below otherwise
  const labelYPosition = isHovered ? radius * 1.5 : -radius * 1.5;
  const labelAnchorY = isHovered ? "bottom" : "top";

  return (
    <group name={englishName} ref={groupRef}>
      {/* Invisible hitbox for interaction - always large enough to click */}
      <mesh
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
        renderOrder={-1}
      >
        <sphereGeometry args={[hitboxRadius, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Axial Tilt Pivot Group */}
      <group rotation={[0, 0, THREE.MathUtils.degToRad(axialTilt)]}>
        {/* Visible planet mesh */}
        <mesh
          ref={meshRef}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onPointerEnter={() => setIsHovered(true)}
          onPointerLeave={() => setIsHovered(false)}
        >
          <sphereGeometry args={[radius, segments, segments]} />
          <meshStandardMaterial
            map={texture}
            emissive={0x333333}
            emissiveIntensity={0.05}
          />
        </mesh>
        {/* Future Rings will go here to stay tilted with planet */}
      </group>

      {/* Hover Ring - white elliptical border around planet */}
      {isHovered && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ringInnerRadius, ringOuterRadius, 64]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}


      {/* 3D Text Label - white and above planet on hover */}
      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <Text
          position={[0, labelYPosition, 0]}
          fontSize={fontSize}
          color={labelColor}
          anchorX="center"
          anchorY={labelAnchorY as "top" | "bottom"}
          outlineWidth={fontSize * 0.04}
          outlineColor="#000000"
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        >
          {englishName.toUpperCase()}
        </Text>
      </Billboard>
      {children}
    </group>
  );
}
