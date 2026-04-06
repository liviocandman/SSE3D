import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { OrionProxyModel } from './OrionProxyModel';
import type { MissionQuaternion } from '@/lib/missionTypes';
import { ORION_MESH_TO_BODY_QUATERNION } from '@/lib/missionAttitudeCalibration';

export interface SpacecraftBodyProps {
  vehicleId: string;
  label: string;
  position: [number, number, number];
  fallbackHeading?: [number, number, number] | null;
  isSelected: boolean;
  onClick: (id: string) => void;
  onDoubleClick?: (id: string) => void;
  attitudeQuaternion?: MissionQuaternion;
  useAttitude?: boolean; // Story 8.3: Feature flag
}

export const SPACECRAFT_SELECTION_RADIUS_UNITS = 0.0005;
export const SPACECRAFT_CLOSEUP_RADIUS_UNITS = 0.00008;
export const SPACECRAFT_EVENT_FOCUS_RADIUS_UNITS = 0.0015;
const SPACECRAFT_PROXY_DISTANCE_ENTER_UNITS = 0.06;
const SPACECRAFT_PROXY_DISTANCE_EXIT_UNITS = 0.1;
const SPACECRAFT_INSPECTION_DISTANCE_ENTER_UNITS = 0.01;
const SPACECRAFT_INSPECTION_DISTANCE_EXIT_UNITS = 0.05;
const SPACECRAFT_INSPECTION_DISTANCE_EXIT_UNLOCKED_UNITS = 0.02;
const SPACECRAFT_INSPECTION_DISTANCE_EXIT_SELECTED_UNITS = 0.03;
const SPACECRAFT_DETAILED_PRELOAD_DISTANCE_UNITS = 0.02;
const MARKER_MIN_SCALE_UNITS = 0.002;
const MARKER_MAX_SCALE_UNITS = 0.2;
const MARKER_DISTANCE_SCALE_FACTOR = 0.02;
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
    context.lineWidth = 2;
    context.strokeStyle = color;
    context.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

function buildProgradeQuaternion(direction: THREE.Vector3) {
  const xAxis = direction.clone().normalize();
  const upHint = new THREE.Vector3(0, 1, 0);

  let yAxis = new THREE.Vector3().crossVectors(upHint, xAxis);
  if (yAxis.lengthSq() <= 1e-12) {
    yAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), xAxis);
  }
  yAxis.normalize();

  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);

  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

export function SpacecraftBody({
  vehicleId,
  label,
  position,
  fallbackHeading = null,
  isSelected,
  onClick,
  onDoubleClick,
  attitudeQuaternion,
  useAttitude = false,
}: SpacecraftBodyProps) {
  const groupRef = useRef<THREE.Group>(null);
  const markerRef = useRef<THREE.Sprite>(null);
  const visualRootRef = useRef<THREE.Group>(null);
  const proxyRef = useRef<THREE.Group>(null);
  const detailedRef = useRef<THREE.Group>(null);
  const worldPositionRef = useRef(new THREE.Vector3());
  const previousWorldPositionRef = useRef<THREE.Vector3 | null>(null);
  const progradeQuaternionRef = useRef(new THREE.Quaternion());
  const progradeDirectionRef = useRef(new THREE.Vector3(1, 0, 0));
  const lodModeRef = useRef<SpacecraftLodMode>('marker');
  const detailedLoadRequestedRef = useRef(false);
  const detailedUnlockedRef = useRef(false);
  const [shouldLoadDetailed, setShouldLoadDetailed] = useState(false);
  const [isDetailedReady, setIsDetailedReady] = useState(false);
  const meshToBodyAlignmentQuat = useMemo(
    () => new THREE.Quaternion().copy(ORION_MESH_TO_BODY_QUATERNION),
    []
  );

  const markerTexture = useMemo(() => createCircleTexture('#d0dadfff'), []);
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
    let nextLod: SpacecraftLodMode = currentLod;

    if (!detailedLoadRequestedRef.current && (isSelected || dist <= SPACECRAFT_DETAILED_PRELOAD_DISTANCE_UNITS)) {
      detailedLoadRequestedRef.current = true;
      setShouldLoadDetailed(true);
    }

    const detailedExitThreshold = isSelected
      ? SPACECRAFT_INSPECTION_DISTANCE_EXIT_SELECTED_UNITS
      : detailedUnlockedRef.current
        ? SPACECRAFT_INSPECTION_DISTANCE_EXIT_UNLOCKED_UNITS
        : SPACECRAFT_INSPECTION_DISTANCE_EXIT_UNITS;

    switch (currentLod) {
      case 'marker':
        if (dist <= SPACECRAFT_INSPECTION_DISTANCE_ENTER_UNITS) {
          nextLod = isDetailedReady ? 'detailed' : 'proxy';
        } else if (isSelected || dist <= SPACECRAFT_PROXY_DISTANCE_ENTER_UNITS) {
          nextLod = 'proxy';
        }
        break;
      case 'proxy':
        if (dist <= SPACECRAFT_INSPECTION_DISTANCE_ENTER_UNITS) {
          nextLod = isDetailedReady ? 'detailed' : 'proxy';
        } else if (!isSelected && dist >= SPACECRAFT_PROXY_DISTANCE_EXIT_UNITS) {
          nextLod = 'marker';
        }
        break;
      case 'detailed':
        if (!isDetailedReady) {
          nextLod = 'proxy';
        } else if (dist >= detailedExitThreshold) {
          nextLod = 'proxy';
        }
        break;
    }

    if (nextLod === 'detailed') {
      detailedUnlockedRef.current = true;
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
      if (useAttitude && attitudeQuaternion) {
        visualRootRef.current.quaternion
          .set(
            attitudeQuaternion.x,
            attitudeQuaternion.y,
            attitudeQuaternion.z,
            attitudeQuaternion.w
          )
          .normalize()
          .multiply(meshToBodyAlignmentQuat);
      } else {
        let headingResolved = false;

        if (fallbackHeading) {
          const trajectoryHeading = new THREE.Vector3(
            fallbackHeading[0],
            fallbackHeading[1],
            fallbackHeading[2]
          );
          if (trajectoryHeading.lengthSq() > 1e-18) {
            progradeDirectionRef.current.copy(trajectoryHeading).normalize();
            progradeQuaternionRef.current.copy(buildProgradeQuaternion(progradeDirectionRef.current));
            headingResolved = true;
          }
        }

        if (!headingResolved) {
          const previousWorldPosition = previousWorldPositionRef.current;
          if (previousWorldPosition) {
            const travelDirection = worldPosition.clone().sub(previousWorldPosition);
            if (travelDirection.lengthSq() > 1e-18) {
              progradeDirectionRef.current.copy(travelDirection).normalize();
              progradeQuaternionRef.current.copy(buildProgradeQuaternion(progradeDirectionRef.current));
            }
          }
        }

        visualRootRef.current.quaternion.copy(progradeQuaternionRef.current).multiply(meshToBodyAlignmentQuat);
      }
    }

    if (previousWorldPositionRef.current) {
      previousWorldPositionRef.current.copy(worldPosition);
    } else {
      previousWorldPositionRef.current = worldPosition.clone();
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
