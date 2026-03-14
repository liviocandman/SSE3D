"use client";

import { useRef, useState } from "react";
import { useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import { useTexture, Text, Billboard } from "@react-three/drei";
import type { Mesh } from "three";
import * as THREE from "three";
import "../../app/globals.css";
import { PlanetMarker } from "./PlanetMarker";
import type { ViewMode } from "@/lib/scales";

// --- Types ---

interface CelestialBodyProps {
  name: string;
  englishName: string;
  bodyId: string;
  position: [number, number, number];
  radius: number;
  textureUrl: string;
  rotationSpeed?: number;
  onClick?: (bodyId: string) => void;
  onDoubleClick?: (bodyId: string) => void;
  viewMode?: ViewMode;
}

// --- Constants ---

const DEFAULT_ROTATION_SPEED = 0.002;
const LABEL_COLOR = "#a3cffe";
const MIN_FONT_SIZE = 2;
const MAX_FONT_SIZE = 100;
const THROTTLE_FRAMES = 10;

// Marker fade constants
const MARKER_FADE_START = 500;
const MARKER_FADE_END = 100;

// --- Component ---

export function CelestialBody({
  englishName,
  bodyId,
  position,
  radius,
  textureUrl,
  rotationSpeed = DEFAULT_ROTATION_SPEED,
  onClick,
  onDoubleClick,
  viewMode = "didactic",
}: CelestialBodyProps) {
  const meshRef = useRef<Mesh>(null);
  const texture = useTexture(textureUrl);
  const [fontSize, setFontSize] = useState(5);
  const [markerOpacity, setMarkerOpacity] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const { camera } = useThree();

  const tempVec = useRef(new THREE.Vector3());
  const frameCountRef = useRef(0);

  // Animation loop
  useFrame(() => {
    // Planet rotation (every frame)
    if (meshRef.current) {
      meshRef.current.rotation.y += rotationSpeed;
    }

    // Throttled calculations
    frameCountRef.current++;
    if (frameCountRef.current % THROTTLE_FRAMES !== 0) return;

    // Calculate distance from camera to planet
    tempVec.current.set(position[0], position[1], position[2]);
    const distance = camera.position.distanceTo(tempVec.current);

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

    // --- Marker Opacity (realistic mode only) ---
    if (viewMode === "realistic") {
      // Hide marker when camera is close (absolute distance check)
      // This ensures marker disappears when zoomed in on planets
      if (distance < 1.0) {
        if (markerOpacity !== 0) {
          setMarkerOpacity(0);
        }
      } else {
        // Calculate relative distance for fade
        const relativeDistance = distance / radius;

        let newOpacity: number;
        if (relativeDistance > MARKER_FADE_START) {
          newOpacity = 1;
        } else if (relativeDistance < MARKER_FADE_END) {
          newOpacity = 0;
        } else {
          newOpacity =
            (relativeDistance - MARKER_FADE_END) /
            (MARKER_FADE_START - MARKER_FADE_END);
        }

        if (Math.abs(newOpacity - markerOpacity) > 0.02) {
          setMarkerOpacity(newOpacity);
        }
      }
    } else if (markerOpacity > 0) {
      setMarkerOpacity(0);
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
    <group position={position}>
      {/* Invisible hitbox for interaction - always large enough to click */}
      <mesh
        visible={false}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
      >
        <sphereGeometry args={[hitboxRadius, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Visible planet mesh */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[radius, 64, 64]} />
        <meshStandardMaterial
          map={texture}
          emissive={0x333333}
          emissiveIntensity={0.05}
        />
      </mesh>

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

      {/* LOD Marker - visible in realistic mode when far */}
      {viewMode === "realistic" && markerOpacity > 0 && (
        <PlanetMarker opacity={markerOpacity} />
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
    </group>
  );
}
