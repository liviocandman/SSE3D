import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { SPACECRAFT_RADIUS_KM, KM_TO_UNIT } from '@/lib/scales';

export interface SpacecraftBodyProps {
  vehicleId: string;
  label: string;
  position: [number, number, number];
  isSelected: boolean;
  onClick: (id: string) => void;
}

// 5 meters in km converted to units
const SPACECRAFT_ACTUAL_RADIUS_UNITS = SPACECRAFT_RADIUS_KM * KM_TO_UNIT;
const MODEL_MODE_THRESHOLD_PX = 18;

function createCircleTexture(color: string) {
  // If we are in a test environment without DOM, return empty texture
  if (typeof document === 'undefined') return new THREE.Texture();

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.beginPath();
    context.arc(32, 32, 30, 0, 2 * Math.PI, false);
    context.fillStyle = color;
    context.fill();
    context.lineWidth = 4;
    context.strokeStyle = '#ffffff';
    context.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

export function SpacecraftBody({
  vehicleId,
  label,
  position,
  isSelected,
  onClick,
}: SpacecraftBodyProps) {
  const groupRef = useRef<THREE.Group>(null);
  const markerRef = useRef<THREE.Sprite>(null);
  const modelRef = useRef<THREE.Group>(null);

  const markerTexture = useMemo(() => createCircleTexture(isSelected ? '#ffffff' : '#00aaff'), [isSelected]);

  useFrame((state) => {
    if (!groupRef.current || !markerRef.current || !modelRef.current) return;

    const dist = state.camera.position.distanceTo(groupRef.current.position);
    const perspectiveCamera = state.camera as THREE.PerspectiveCamera;
    const verticalFovRadians = THREE.MathUtils.degToRad(perspectiveCamera.fov);
    const visibleHeightAtDistance = 2 * Math.tan(verticalFovRadians / 2) * dist;
    const apparentPixelHeight =
      visibleHeightAtDistance > 0
        ? ((SPACECRAFT_ACTUAL_RADIUS_UNITS * 2) / visibleHeightAtDistance) * state.size.height
        : 0;

    // Use an inexpensive apparent-size heuristic instead of a raw world-distance threshold.
    const isModelMode = apparentPixelHeight >= MODEL_MODE_THRESHOLD_PX;

    // Only mutate if changed
    if (markerRef.current.visible === isModelMode) {
      markerRef.current.visible = !isModelMode;
      modelRef.current.visible = isModelMode;
    }
  });

  return (
    <group
      ref={groupRef}
      position={position}
      name={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick(vehicleId);
      }}
    >
      {/* Marker Mode - Sprite automatically retains constant pixel size via sizeAttenuation=false */}
      <sprite ref={markerRef} scale={[0.015, 0.015, 1]}>
        <spriteMaterial map={markerTexture} sizeAttenuation={false} depthTest={false} />
      </sprite>

      {/* Label - Html handles CSS-based sizing outside the 3D render loop */}
      <Html center style={{ pointerEvents: 'none', transform: 'translate3d(0, 20px, 0)' }}>
        <div style={{
          color: isSelected ? '#ffffff' : '#cccccc',
          fontSize: '14px',
          textShadow: '1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000',
          whiteSpace: 'nowrap',
          fontFamily: 'sans-serif',
        }}>
          {label}
        </div>
      </Html>

      {/* Model Mode (Geometric Placeholder) */}
      <group ref={modelRef} visible={false}>
        {/* Simple geometric placeholder representing a capsule */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry
            args={[
              SPACECRAFT_ACTUAL_RADIUS_UNITS,
              SPACECRAFT_ACTUAL_RADIUS_UNITS * 2,
              16,
            ]}
          />
          <meshStandardMaterial
            color={isSelected ? '#ffffff' : '#aaaaaa'}
            emissive={isSelected ? '#333333' : '#111111'}
          />
        </mesh>
      </group>
    </group>
  );
}
