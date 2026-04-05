import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { OrionProxyModel } from './OrionProxyModel';

export interface SpacecraftBodyProps {
  vehicleId: string;
  label: string;
  position: [number, number, number];
  isSelected: boolean;
  onClick: (id: string) => void;
  onDoubleClick?: (id: string) => void;
  attitude?: [number, number, number]; // [pitch, yaw, roll] in radians
  useAttitude?: boolean; // Story 8.3: Feature flag
}

export const SPACECRAFT_SELECTION_RADIUS_UNITS = 0.0005;
export const SPACECRAFT_CLOSEUP_RADIUS_UNITS = 0.00008;
export const SPACECRAFT_EVENT_FOCUS_RADIUS_UNITS = 0.0015;
const SPACECRAFT_PROXY_DISTANCE_EXIT_UNITS = 0.02;
const SPACECRAFT_INSPECTION_DISTANCE_ENTER_UNITS = 0.002;
const SPACECRAFT_INSPECTION_DISTANCE_EXIT_UNITS = 0.0028;
const MARKER_MIN_SCALE_UNITS = 0.0015;
const MARKER_MAX_SCALE_UNITS = 1;
const MARKER_DISTANCE_SCALE_FACTOR = 0.0005;
const PROXY_TARGET_HEIGHT_UNITS = 0.0001;
const DETAILED_TARGET_HEIGHT_UNITS = 0.00012;

const LazyOrionDetailedModel = lazy(async () => {
  const module = await import('./OrionDetailedModel');
  return { default: module.OrionDetailedModel };
});

type SpacecraftLodMode = 'marker' | 'proxy' | 'detailed';

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
    context.strokeStyle = color;
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
  onDoubleClick,
  attitude,
  useAttitude = false,
}: SpacecraftBodyProps) {
  const groupRef = useRef<THREE.Group>(null);
  const markerRef = useRef<THREE.Sprite>(null);
  const visualRootRef = useRef<THREE.Group>(null);
  const proxyRef = useRef<THREE.Group>(null);
  const detailedRef = useRef<THREE.Group>(null);
  const worldPositionRef = useRef(new THREE.Vector3());
  const lodModeRef = useRef<SpacecraftLodMode>('marker');
  const inspectionModeRef = useRef(false);
  const detailedLoadRequestedRef = useRef(false);
  const [shouldLoadDetailed, setShouldLoadDetailed] = useState(false);
  const [isDetailedReady, setIsDetailedReady] = useState(false);

  const markerTexture = useMemo(() => createCircleTexture('#00aaff'), []);
  const handleDetailedReady = useCallback(() => {
    setIsDetailedReady(true);
  }, []);

  useEffect(() => {
    if (isSelected && !detailedLoadRequestedRef.current) {
      detailedLoadRequestedRef.current = true;
      setShouldLoadDetailed(true);
    }
  }, [isSelected]);

  useFrame((state) => {
    if (!groupRef.current || !markerRef.current || !visualRootRef.current || !proxyRef.current || !detailedRef.current) {
      return;
    }

    const worldPosition = groupRef.current.getWorldPosition(worldPositionRef.current);
    const dist = state.camera.position.distanceTo(worldPosition);
    const currentLod = lodModeRef.current;

    const inspectionMode = isSelected
      ? inspectionModeRef.current
        ? dist <= SPACECRAFT_INSPECTION_DISTANCE_EXIT_UNITS
        : dist <= SPACECRAFT_INSPECTION_DISTANCE_ENTER_UNITS
      : false;

    inspectionModeRef.current = inspectionMode;
    let nextLod: SpacecraftLodMode = currentLod;

    if (inspectionMode) {
      nextLod = isDetailedReady ? 'detailed' : 'proxy';
    } else if (isSelected || dist <= SPACECRAFT_PROXY_DISTANCE_EXIT_UNITS) {
      nextLod = 'proxy';
    } else {
      nextLod = 'marker';
    }

    lodModeRef.current = nextLod;
    markerRef.current.visible = nextLod === 'marker';
    proxyRef.current.visible = nextLod === 'proxy';
    detailedRef.current.visible = nextLod === 'detailed';

    const markerScale = THREE.MathUtils.clamp(
      dist * MARKER_DISTANCE_SCALE_FACTOR,
      MARKER_MIN_SCALE_UNITS,
      MARKER_MAX_SCALE_UNITS
    );
    markerRef.current.scale.set(markerScale, markerScale, 1);

    if (visualRootRef.current) {
      if (useAttitude && attitude) {
        visualRootRef.current.rotation.set(attitude[0], attitude[1], attitude[2]);
      } else {
        visualRootRef.current.rotation.set(Math.PI / 2, 0, 0);
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
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.(vehicleId);
      }}
    >
      {/* Marker Mode */}
      <sprite ref={markerRef} scale={[MARKER_MIN_SCALE_UNITS, MARKER_MIN_SCALE_UNITS, 1]}>
        <spriteMaterial map={markerTexture} depthTest={false} />
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

      <group ref={visualRootRef}>
        <group ref={proxyRef} visible={false}>
          <OrionProxyModel unitScale={PROXY_TARGET_HEIGHT_UNITS} isSelected={isSelected} />
        </group>

        <group ref={detailedRef} visible={false}>
          {shouldLoadDetailed && (
            <Suspense fallback={null}>
              <LazyOrionDetailedModel
                targetHeight={DETAILED_TARGET_HEIGHT_UNITS}
                onReady={handleDetailedReady}
              />
            </Suspense>
          )}
        </group>

      </group>
    </group>
  );
}
