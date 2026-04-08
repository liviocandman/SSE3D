import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { scalePositionFromKm } from '@/lib/scales';
import { MissionTrajectoryPoint } from '@/lib/missionTypes';
import { densifyWithCatmullRom } from '@/lib/catmullRom';
import { EphemerisTrajectory } from '@/lib/types';
import { useSolarStore } from '@/store/solarStore';
import { sampleTrajectoryAtTime, type TrajectorySegment } from '@/lib/trajectoryEngine';

interface MissionTrajectoryLineProps {
  past: MissionTrajectoryPoint[];
  planned: MissionTrajectoryPoint[];
  missionTrajectorySegment: TrajectorySegment | null;
  smoothing?: boolean;
  velocityThreshold?: number;
}

const isValidPoint = (p: [number, number, number]) => 
  Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);

function scaleMissionPoint(point: MissionTrajectoryPoint): [number, number, number] {
  return scalePositionFromKm(point.position.x, point.position.y, point.position.z);
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
  missionTrajectorySegment,
  smoothing = false,
  velocityThreshold = 5,
}) => {
  const pastLineRef = useRef<DreiLineRef>(null);
  const plannedLineRef = useRef<DreiLineRef>(null);

  // 1. Process Past & Planned base points (Low frequency)
  // Points are Earth-relative KM scaled to render units.
  const basePastPoints = useMemo(() => {
    let sourcePoints = [...past];
    if (smoothing && sourcePoints.length >= 3) {
      sourcePoints = densifyWithCatmullRom(
        sourcePoints as unknown as EphemerisTrajectory[], 
        4, 
        { velocityThreshold }
      ) as unknown as MissionTrajectoryPoint[];
    }
    return sourcePoints.map(scaleMissionPoint).filter(isValidPoint);
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
    return sourcePoints.map(scaleMissionPoint).filter(isValidPoint);
  }, [planned, smoothing, velocityThreshold]);

  // Pre-allocate buffers
  const pastPosBuffer = useRef(new Float32Array((basePastPoints.length + 1) * 3));
  const plannedPosBuffer = useRef(new Float32Array((basePlannedPoints.length + 1) * 3));

  useEffect(() => {
    pastPosBuffer.current = new Float32Array((basePastPoints.length + 1) * 3);
  }, [basePastPoints.length]);

  useEffect(() => {
    plannedPosBuffer.current = new Float32Array((basePlannedPoints.length + 1) * 3);
  }, [basePlannedPoints.length]);

  useFrame(() => {
    const solarState = useSolarStore.getState();
    const simTimeMs = solarState.currentTime.getTime();

    // Sample current position in Earth-relative KM
    let currentPosLocalUnits: [number, number, number] | null = null;
    if (missionTrajectorySegment) {
      const sampled = sampleTrajectoryAtTime([missionTrajectorySegment], simTimeMs);
      if (sampled) {
        currentPosLocalUnits = scalePositionFromKm(sampled.position.x, sampled.position.y, sampled.position.z);
      }
    }

    // Update Past Line
    if (pastLineRef.current && currentPosLocalUnits) {
      const count = basePastPoints.length + 1;
      const pos = pastPosBuffer.current;
      
      // Copy base points (already in local render units)
      for (let i = 0; i < basePastPoints.length; i++) {
        const p = basePastPoints[i];
        pos[i * 3] = p[0];
        pos[i * 3 + 1] = p[1];
        pos[i * 3 + 2] = p[2];
      }
      
      // Append current point (also in local render units)
      pos[(count - 1) * 3] = currentPosLocalUnits[0];
      pos[(count - 1) * 3 + 1] = currentPosLocalUnits[1];
      pos[(count - 1) * 3 + 2] = currentPosLocalUnits[2];

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
    } else if (pastLineRef.current) {
      pastLineRef.current.visible = false;
    }

    // Update Planned Line
    if (plannedLineRef.current && currentPosLocalUnits) {
      const count = basePlannedPoints.length + 1;
      const pos = plannedPosBuffer.current;
      
      // Start with current point
      pos[0] = currentPosLocalUnits[0];
      pos[1] = currentPosLocalUnits[1];
      pos[2] = currentPosLocalUnits[2];

      // Copy base points
      for (let i = 0; i < basePlannedPoints.length; i++) {
        const p = basePlannedPoints[i];
        pos[(i + 1) * 3] = p[0];
        pos[(i + 1) * 3 + 1] = p[1];
        pos[(i + 1) * 3 + 2] = p[2];
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
      if ('computeLineDistances' in plannedLineRef.current && typeof plannedLineRef.current.computeLineDistances === 'function') {
        plannedLineRef.current.computeLineDistances();
      }
      plannedLineRef.current.visible = true;
    } else if (plannedLineRef.current) {
      plannedLineRef.current.visible = false;
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
