import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { KM_TO_UNIT } from '@/lib/scales';
import { OrionProxyModel } from './OrionProxyModel';
import type { MissionQuaternion } from '@/lib/missionTypes';
import { MissionPhase } from '@/lib/missionTypes';
import { ORION_MESH_TO_BODY_QUATERNION } from '@/lib/missionAttitudeCalibration';
import { useSolarStore } from '@/store/solarStore';
import { useMissionStore } from '@/store/missionStore';
import type { EphemerisData } from '@/lib/types';
import { clockRuntime } from '@/lib/time/clockRuntime';
import { resolveMissionFrame } from '@/lib/simulation/frameResolvers';

export interface SpacecraftBodyProps {
  vehicleId: string;
  label: string;
  isSelected: boolean;
  onClick: (id: string) => void;
  onDoubleClick?: (id: string) => void;
  attitudeQuaternion?: MissionQuaternion;
  useAttitude?: boolean; // Story 8.3: Feature flag
  earthEphemeris: EphemerisData | null;
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
const SPACECRAFT_POSITION_DAMPING = 16;
const SPACECRAFT_ATTITUDE_DAMPING = 12;
const LOD_UPDATE_INTERVAL_FRAMES = 3;
const AUTO_FOCUS_CHECK_INTERVAL_FRAMES = 6;

const LazyOrionDetailedModel = lazy(async () => {
  const orionDetailedModule = await import('./OrionDetailedModel');
  return { default: orionDetailedModule.OrionDetailedModel };
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

function normalizeKm(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

export function SpacecraftBody({
  vehicleId,
  label,
  isSelected,
  onClick,
  onDoubleClick,
  attitudeQuaternion,
  useAttitude = false,
  earthEphemeris,
}: SpacecraftBodyProps) {
  const groupRef = useRef<THREE.Group>(null);
  const markerRef = useRef<THREE.Sprite>(null);
  const visualRootRef = useRef<THREE.Group>(null);
  const proxyRef = useRef<THREE.Group>(null);
  const detailedRef = useRef<THREE.Group>(null);
  const worldPositionRef = useRef(new THREE.Vector3());
  const previousEarthRelativePositionKmRef = useRef<THREE.Vector3 | null>(null);
  const absPositionKmRef = useRef(new THREE.Vector3());
  const earthRelativePositionKmRef = useRef(new THREE.Vector3());
  const headingQuaternionRef = useRef(new THREE.Quaternion());
  const targetLocalPositionRef = useRef(new THREE.Vector3(0, 0, 0));
  const positionInitializedRef = useRef(false);
  const targetAttitudeQuaternionRef = useRef(new THREE.Quaternion());
  const lodModeRef = useRef<SpacecraftLodMode>('marker');
  const detailedLoadRequestedRef = useRef(false);
  const detailedUnlockedRef = useRef(false);
  const [shouldLoadDetailed, setShouldLoadDetailed] = useState(false);
  const [isDetailedReady, setIsDetailedReady] = useState(false);
  const meshToBodyAlignmentQuat = useMemo(
    () => new THREE.Quaternion().copy(ORION_MESH_TO_BODY_QUATERNION),
    []
  );

  // --- Auto-focus State ---
  const armedAutoFocusEventsRef = useRef<Set<string>>(new Set());
  const lodFrameCounterRef = useRef(0);
  const autoFocusFrameCounterRef = useRef(0);
  const lastDistanceRef = useRef(Number.POSITIVE_INFINITY);
  const setTravelTarget = useSolarStore(state => state.setTravelTarget);
  const missionEvents = useMissionStore(state => state.missionEvents);
  const autoFocusEvents = useMissionStore(state => state.autoFocusEvents);

  // Pre-calculate event timestamps to avoid new Date() in useFrame
  const eventsWithTime = useMemo(() => {
    if (!missionEvents?.events) return [];
    return missionEvents.events.map(ev => ({
      ...ev,
      timeMs: new Date(ev.timestamp).getTime()
    }));
  }, [missionEvents]);

  const markerTexture = useMemo(() => createCircleTexture('#d0dadfff'), []);
  useEffect(() => {
    return () => {
      markerTexture.dispose();
    };
  }, [markerTexture]);

  const handleDetailedReady = useCallback(() => {
    setIsDetailedReady(true);
  }, []);

  const resolveSpacecraftWorldPositionKm = useCallback(() => {
    if (positionInitializedRef.current) {
      return {
        x: absPositionKmRef.current.x,
        y: absPositionKmRef.current.y,
        z: absPositionKmRef.current.z,
      };
    }
    return null;
  }, []);

  useEffect(() => {
    if (isSelected && !detailedLoadRequestedRef.current) {
      detailedLoadRequestedRef.current = true;
      setShouldLoadDetailed(true);
    }
  }, [isSelected]);

  useFrame((state, delta) => {
    if (!groupRef.current || !markerRef.current || !visualRootRef.current || !proxyRef.current || !detailedRef.current) {
      return;
    }

    const simTimeMs = clockRuntime.getTimeMs();

    // 1. Resolve spacecraft state using simulation layer
    const source = resolveMissionFrame(
      simTimeMs,
      absPositionKmRef.current,
      earthRelativePositionKmRef.current,
      headingQuaternionRef.current,
      previousEarthRelativePositionKmRef.current
    );

    if (source !== 'none') {
      // EarthMissionLayer is mounted under Earth's CelestialBody group. That
      // parent already applies renderOrigin, so Orion remains Earth-local here.
      targetLocalPositionRef.current.set(
        normalizeKm(earthRelativePositionKmRef.current.x) * KM_TO_UNIT,
        normalizeKm(earthRelativePositionKmRef.current.y) * KM_TO_UNIT,
        normalizeKm(earthRelativePositionKmRef.current.z) * KM_TO_UNIT
      );

      if (!positionInitializedRef.current) {
        groupRef.current.position.copy(targetLocalPositionRef.current);
        positionInitializedRef.current = true;
      }
    }

    // Update previous position for next frame's heading calculation
    if (!previousEarthRelativePositionKmRef.current) {
      previousEarthRelativePositionKmRef.current = new THREE.Vector3();
    }
    previousEarthRelativePositionKmRef.current.copy(earthRelativePositionKmRef.current);

    // 2. Position Damping
    const positionLerpFactor = 1 - Math.exp(-SPACECRAFT_POSITION_DAMPING * delta);
    groupRef.current.position.lerp(targetLocalPositionRef.current, positionLerpFactor);

    lodFrameCounterRef.current += 1;
    if (lodFrameCounterRef.current >= LOD_UPDATE_INTERVAL_FRAMES) {
      lodFrameCounterRef.current = 0;
      const worldPosition = groupRef.current.getWorldPosition(worldPositionRef.current);
      lastDistanceRef.current = state.camera.position.distanceTo(worldPosition);
    }
    const dist = lastDistanceRef.current;
    const currentLod = lodModeRef.current;
    let nextLod: SpacecraftLodMode = currentLod;

    // 3. LOD Switching
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

    // 4. Attitude and Orientation
    if (visualRootRef.current) {
      if (useAttitude && attitudeQuaternion) {
        targetAttitudeQuaternionRef.current
          .set(
            attitudeQuaternion.x,
            attitudeQuaternion.y,
            attitudeQuaternion.z,
            attitudeQuaternion.w
          )
          .normalize()
          .multiply(meshToBodyAlignmentQuat);
      } else {
        // Use resolved prograde heading from simulation layer
        targetAttitudeQuaternionRef.current.copy(headingQuaternionRef.current).multiply(meshToBodyAlignmentQuat);
      }

      const attitudeLerpFactor = 1 - Math.exp(-SPACECRAFT_ATTITUDE_DAMPING * delta);
      visualRootRef.current.quaternion.slerp(targetAttitudeQuaternionRef.current, attitudeLerpFactor);
    }

    // 5. Auto-focus Logic
    autoFocusFrameCounterRef.current += 1;
    if (
      autoFocusEvents &&
      eventsWithTime.length > 0 &&
      earthEphemeris &&
      autoFocusFrameCounterRef.current >= AUTO_FOCUS_CHECK_INTERVAL_FRAMES
    ) {
      autoFocusFrameCounterRef.current = 0;
      const majorPhases = [
        MissionPhase.EARTH_DEPARTURE,
        MissionPhase.LUNAR_FLYBY,
        MissionPhase.REENTRY
      ];

      // 1 minute window for auto-focus trigger
      const focusWindowMs = 60 * 1000;

      for (const ev of eventsWithTime) {
        if (!majorPhases.includes(ev.phase as MissionPhase)) continue;

        const evTime = ev.timeMs;
        if (!Number.isFinite(evTime)) continue;
        const diff = Math.abs(simTimeMs - evTime);
        const isWithinWindow = diff < focusWindowMs;

        if (!isWithinWindow) {
          armedAutoFocusEventsRef.current.delete(ev.id);
          continue;
        }

        if (!armedAutoFocusEventsRef.current.has(ev.id)) {
          // Trigger non-intrusive focus
          const spacecraftWorldPos = resolveSpacecraftWorldPositionKm();
          if (spacecraftWorldPos) {
            setTravelTarget(spacecraftWorldPos, SPACECRAFT_EVENT_FOCUS_RADIUS_UNITS);
            armedAutoFocusEventsRef.current.add(ev.id);
            break;
          }
        }
      }
    }
  });

  const handleInteraction = (type: 'click' | 'doubleClick') => {
    onClick(vehicleId);
    if (type === 'doubleClick' && onDoubleClick) {
      onDoubleClick(vehicleId);
    }

    const spacecraftWorldPos = resolveSpacecraftWorldPositionKm();
    if (spacecraftWorldPos) {
      const radius = type === 'click' ? SPACECRAFT_SELECTION_RADIUS_UNITS : SPACECRAFT_CLOSEUP_RADIUS_UNITS;
      setTravelTarget(spacecraftWorldPos, radius);
    }
  };

  return (
    <group
      ref={groupRef}
      name={label}
      onClick={(e) => {
        e.stopPropagation();
        handleInteraction('click');
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        handleInteraction('doubleClick');
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
