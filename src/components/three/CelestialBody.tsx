"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree, ThreeEvent, useLoader } from "@react-three/fiber";
import { Text, Billboard } from "@react-three/drei";
import { TextureLoader } from "three";
import type { Mesh } from "three";
import * as THREE from "three";
import "../../app/globals.css";
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
  segments?: number;
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

// --- Component ---

export function CelestialBody({
  englishName,
  bodyId,
  position,
  radius,
  textureUrl,
  rotationSpeed = DEFAULT_ROTATION_SPEED,
  segments = 64,
  onClick,
  onDoubleClick,
  viewMode = "didactic",
}: CelestialBodyProps) {
  const meshRef = useRef<Mesh>(null);

  // Use useLoader directly to have access to useLoader.clear() for global cache cleanup
  // Note: clearing cache on unmount during Suspense can cause infinite loops.
  const texture = useLoader(TextureLoader, textureUrl, (loader) => {
    loader.setCrossOrigin("anonymous");
  });

  const [fontSize, setFontSize] = useState(5);
  const [isHovered, setIsHovered] = useState(false);
  const { camera } = useThree();

  const tempVec = useRef(new THREE.Vector3());
  const frameCountRef = useRef(0);

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
  useFrame(() => {
    // Planet rotation (every frame)
    if (meshRef.current) {
      meshRef.current.rotation.y += rotationSpeed;
    }

    // Throttled calculations
    frameCountRef.current++;

    // Calculate squared distance (no sqrt, faster) for adaptive throttling
    tempVec.current.set(position[0], position[1], position[2]);
    const distanceSq = camera.position.distanceToSquared(tempVec.current);

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
    <group position={position}>
      {/* Invisible hitbox for interaction - always large enough to click */}
      {/* NOTE: visible={false} disables raycasting in Three.js — we use colorWrite={false}
           + depthWrite={false} instead to keep it invisible but still raycastable. */}
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

      {/* Visible planet mesh — also wires events so clicking the texture itself works */}
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
    </group>
  );
}
