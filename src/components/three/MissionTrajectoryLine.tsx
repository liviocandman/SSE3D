import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { KM_TO_UNIT } from '@/lib/scales';
import { MissionTrajectoryPoint } from '@/lib/missionTypes';
import { densifyWithCatmullRom } from '@/lib/catmullRom';
import { EphemerisTrajectory } from '@/lib/types';
import { clockRuntime } from '@/lib/time/clockRuntime';
import { resolveMissionFrame } from '@/lib/simulation/frameResolvers';

interface MissionTrajectoryLineProps {
  past: MissionTrajectoryPoint[];
  planned: MissionTrajectoryPoint[];
  smoothing?: boolean;
  velocityThreshold?: number;
}

const isValidPoint = (p: [number, number, number]) => 
  Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);

function scaleMissionPointInEarthFrame(point: MissionTrajectoryPoint): [number, number, number] {
  return [
    point.position.x * KM_TO_UNIT,
    point.position.y * KM_TO_UNIT,
    point.position.z * KM_TO_UNIT,
  ];
}

// Fixed geometry type to avoid 'any'
type LineSegmentsGeometry = THREE.BufferGeometry & {
  setPositions: (array: ArrayLike<number>) => void;
  attributes: THREE.BufferGeometry['attributes'] & {
    instanceStart?: THREE.BufferAttribute;
    instanceEnd?: THREE.BufferAttribute;
  };
};

type DreiLineRef = React.ElementRef<typeof Line>;

function isLineSegmentsGeometry(geometry: THREE.BufferGeometry): geometry is LineSegmentsGeometry {
  return 'setPositions' in geometry && typeof (geometry as LineSegmentsGeometry).setPositions === 'function';
}

/**
 * Renders the dedicated mission trajectory for Orion.
 * Ref-driven implementation for high performance (no re-renders on tick).
 */
export const MissionTrajectoryLine: React.FC<MissionTrajectoryLineProps> = ({
  past,
  planned,
  smoothing = false,
  velocityThreshold = 5,
}) => {
  const pastLineRef = useRef<DreiLineRef>(null);
  const plannedLineRef = useRef<DreiLineRef>(null);

  // 1. Process Past & Planned base points (Low frequency)
  // Mission trajectory points are Earth-relative scene KM. This component is
  // mounted under Earth's CelestialBody group, which already applies renderOrigin.
  const basePastPoints = useMemo(() => {
    let sourcePoints = [...past];
    if (smoothing && sourcePoints.length >= 3) {
      sourcePoints = densifyWithCatmullRom(
        sourcePoints as unknown as EphemerisTrajectory[], 
        4, 
        { velocityThreshold }
      ) as unknown as MissionTrajectoryPoint[];
    }
    return sourcePoints.map(scaleMissionPointInEarthFrame).filter(isValidPoint);
  }, [past, smoothing, velocityThreshold]);

  const basePlannedPoints = useMemo(() => {
    let sourcePoints = [...planned];
    if (smoothing && sourcePoints.length >= 3) {
      sourcePoints = densifyWithCatmullRom(
        sourcePoints as unknown as EphemerisTrajectory[], 
        4, 
        { velocityThreshold }
      ) as unknown as MissionTrajectoryPoint[];
    }
    return sourcePoints.map(scaleMissionPointInEarthFrame).filter(isValidPoint);
  }, [planned, smoothing, velocityThreshold]);

  // Pre-allocate buffers
  const pastPosBuffer = useRef(new Float32Array((basePastPoints.length + 1) * 3));
  const plannedPosBuffer = useRef(new Float32Array((basePlannedPoints.length + 1) * 3));
  const absPositionKmRef = useRef(new THREE.Vector3());
  const earthRelativePositionKmRef = useRef(new THREE.Vector3());
  const headingQuaternionRef = useRef(new THREE.Quaternion());

  useEffect(() => {
    pastPosBuffer.current = new Float32Array((basePastPoints.length + 1) * 3);
  }, [basePastPoints.length]);

  useEffect(() => {
    plannedPosBuffer.current = new Float32Array((basePlannedPoints.length + 1) * 3);
  }, [basePlannedPoints.length]);

  useFrame(() => {
    const simTimeMs = clockRuntime.getTimeMs();

    // Sample current position in Earth-relative KM using simulation layer.
    // The Earth parent group carries the render-origin subtraction.
    const source = resolveMissionFrame(
      simTimeMs,
      absPositionKmRef.current,
      earthRelativePositionKmRef.current,
      headingQuaternionRef.current
    );

    let currentPosLocalUnits: [number, number, number] | null = null;
    if (source !== 'none') {
      currentPosLocalUnits = [
        earthRelativePositionKmRef.current.x * KM_TO_UNIT,
        earthRelativePositionKmRef.current.y * KM_TO_UNIT,
        earthRelativePositionKmRef.current.z * KM_TO_UNIT,
      ];
    }

    // Update Past Line
    if (pastLineRef.current) {
      if (basePastPoints.length > 0) {
        const hasCurrentPos = !!currentPosLocalUnits;
        const count = basePastPoints.length + (hasCurrentPos ? 1 : 0);
        const pos = pastPosBuffer.current;
        
        // Copy base points (already in local render units)
        for (let i = 0; i < basePastPoints.length; i++) {
          const p = basePastPoints[i];
          pos[i * 3] = p[0];
          pos[i * 3 + 1] = p[1];
          pos[i * 3 + 2] = p[2];
        }
        
        // Append current point (also in local render units)
        if (hasCurrentPos) {
          pos[(count - 1) * 3] = currentPosLocalUnits![0];
          pos[(count - 1) * 3 + 1] = currentPosLocalUnits![1];
          pos[(count - 1) * 3 + 2] = currentPosLocalUnits![2];
        }

        const geometry = pastLineRef.current.geometry;
        if (isLineSegmentsGeometry(geometry)) {
          geometry.setPositions(pos.subarray(0, count * 3));
          if (geometry.attributes.instanceStart) {
            geometry.attributes.instanceStart.needsUpdate = true;
          }
          if (geometry.attributes.instanceEnd) {
            geometry.attributes.instanceEnd.needsUpdate = true;
          }
        }
        pastLineRef.current.visible = true;
      } else {
        pastLineRef.current.visible = false;
      }
    }

    // Update Planned Line
    if (plannedLineRef.current) {
      if (basePlannedPoints.length > 0) {
        const hasCurrentPos = !!currentPosLocalUnits;
        const count = basePlannedPoints.length + (hasCurrentPos ? 1 : 0);
        const pos = plannedPosBuffer.current;
        
        // Start with current point
        if (hasCurrentPos) {
          pos[0] = currentPosLocalUnits![0];
          pos[1] = currentPosLocalUnits![1];
          pos[2] = currentPosLocalUnits![2];
        }

        const offset = hasCurrentPos ? 1 : 0;
        // Copy base points
        for (let i = 0; i < basePlannedPoints.length; i++) {
          const p = basePlannedPoints[i];
          pos[(i + offset) * 3] = p[0];
          pos[(i + offset) * 3 + 1] = p[1];
          pos[(i + offset) * 3 + 2] = p[2];
        }

        const geometry = plannedLineRef.current.geometry;
        if (isLineSegmentsGeometry(geometry)) {
          geometry.setPositions(pos.subarray(0, count * 3));
          if (geometry.attributes.instanceStart) {
            geometry.attributes.instanceStart.needsUpdate = true;
          }
          if (geometry.attributes.instanceEnd) {
            geometry.attributes.instanceEnd.needsUpdate = true;
          }
        }
        const planRef = plannedLineRef.current as unknown as Record<string, unknown>;
        if (typeof planRef.computeLineDistances === 'function') {
          planRef.computeLineDistances();
        }
        plannedLineRef.current.visible = true;
      } else {
        plannedLineRef.current.visible = false;
      }
    }
  });

  return (
    <group name="mission-trajectory">
      <Line
        ref={pastLineRef}
        points={[[0,0,0], [0,0,0]]} // Placeholder
        color="#00ffff"
        lineWidth={2}
        transparent
        opacity={0.6}
        frustumCulled={false}
      />
      <Line
        ref={plannedLineRef}
        points={[[0,0,0], [0,0,0]]} // Placeholder
        color="#00ffff"
        lineWidth={1.5}
        dashed
        dashScale={50}
        dashSize={0.5}
        gapSize={0.5}
        transparent
        opacity={0.4}
        frustumCulled={false}
      />
    </group>
  );
};
