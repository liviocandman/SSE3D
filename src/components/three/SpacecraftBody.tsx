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
  attitude?: [number, number, number]; // [pitch, yaw, roll] in radians
  useAttitude?: boolean; // Story 8.3: Feature flag
}

// 5 meters in km converted to units
const SPACECRAFT_ACTUAL_RADIUS_UNITS = SPACECRAFT_RADIUS_KM * KM_TO_UNIT;
const MODEL_MODE_THRESHOLD_PX = 18;

function createCircleTexture(color: string) {
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
  attitude,
  useAttitude = false,
}: SpacecraftBodyProps) {
  const groupRef = useRef<THREE.Group>(null);
  const markerRef = useRef<THREE.Sprite>(null);
  const modelRef = useRef<THREE.Group>(null);
  const internalModelRef = useRef<THREE.Group>(null);

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

    const isModelMode = apparentPixelHeight >= MODEL_MODE_THRESHOLD_PX;

    if (markerRef.current.visible === isModelMode) {
      markerRef.current.visible = !isModelMode;
      modelRef.current.visible = isModelMode;
    }

    // --- Story 8.3.1: Neutral fallback orientation ---
    if (internalModelRef.current) {
      if (useAttitude && attitude) {
        internalModelRef.current.rotation.set(attitude[0], attitude[1], attitude[2]);
      } else {
        // Keep neutral orientation (Story 8.3.1)
        internalModelRef.current.rotation.set(Math.PI / 2, 0, 0);
      }
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
      {/* Marker Mode */}
      <sprite ref={markerRef} scale={[0.015, 0.015, 1]}>
        <spriteMaterial map={markerTexture} sizeAttenuation={false} depthTest={false} />
      </sprite>

      {/* Label */}
      <Html center style={{ pointerEvents: 'none', transform: 'translate3d(0, 20px, 0)' }}>
        <div style={{
          color: isSelected ? '#ffffff' : '#cccccc',
          fontSize: '12px',
          fontWeight: 'bold',
          textShadow: '1px 1px 2px #000, -1px -1px 2px #000',
          whiteSpace: 'nowrap',
          fontFamily: 'sans-serif',
          letterSpacing: '0.05em',
          textTransform: 'uppercase'
        }}>
          {label}
        </div>
      </Html>

      {/* Model Mode (Premium Polished Placeholder) */}
      <group ref={modelRef} visible={false}>
        <group ref={internalModelRef}>
          {/* Main Capsule Body */}
          <mesh>
            <coneGeometry
              args={[
                SPACECRAFT_ACTUAL_RADIUS_UNITS,
                SPACECRAFT_ACTUAL_RADIUS_UNITS * 2,
                16,
              ]}
            />
            <meshStandardMaterial
              color={isSelected ? '#ffffff' : '#dddddd'}
              roughness={0.3}
              metalness={0.8}
              emissive={isSelected ? '#222222' : '#000000'}
            />
          </mesh>
          
          {/* Service Module Base */}
          <mesh position={[0, -SPACECRAFT_ACTUAL_RADIUS_UNITS * 0.8, 0]}>
            <cylinderGeometry
              args={[
                SPACECRAFT_ACTUAL_RADIUS_UNITS * 0.9,
                SPACECRAFT_ACTUAL_RADIUS_UNITS * 0.9,
                SPACECRAFT_ACTUAL_RADIUS_UNITS * 0.4,
                16,
              ]}
            />
            <meshStandardMaterial
              color="#444444"
              roughness={0.5}
              metalness={0.5}
            />
          </mesh>

          {/* Simple solar panel placeholders */}
          {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((angle, i) => (
            <mesh 
              key={i} 
              position={[Math.cos(angle) * SPACECRAFT_ACTUAL_RADIUS_UNITS * 1.5, -SPACECRAFT_ACTUAL_RADIUS_UNITS * 0.8, Math.sin(angle) * SPACECRAFT_ACTUAL_RADIUS_UNITS * 1.5]}
              rotation={[0, -angle, 0]}
            >
              <boxGeometry args={[SPACECRAFT_ACTUAL_RADIUS_UNITS * 1.2, 0.0001, SPACECRAFT_ACTUAL_RADIUS_UNITS * 0.4]} />
              <meshStandardMaterial color="#1a2a6c" metalness={0.9} roughness={0.1} />
            </mesh>
          ))}
        </group>

        {/* Dynamic Point Light when selected */}
        {isSelected && (
          <pointLight intensity={0.5} distance={0.5} color="#ffffff" />
        )}
      </group>
    </group>
  );
}
