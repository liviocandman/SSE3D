import React, { useMemo, useRef } from 'react';
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

const EMPTY_LINE_POINTS: [number, number, number][] = [[0, 0, 0], [0, 0, 0]];

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

function updateConnectorLine(
  line: DreiLineRef | null,
  start: [number, number, number] | null,
  end: [number, number, number] | null,
  buffer: Float32Array,
  recomputeLineDistances = false
): void {
  if (!line || !start || !end) {
    if (line) {
      line.visible = false;
    }
    return;
  }

  buffer[0] = start[0];
  buffer[1] = start[1];
  buffer[2] = start[2];
  buffer[3] = end[0];
  buffer[4] = end[1];
  buffer[5] = end[2];

  const geometry = line.geometry;
  if (isLineSegmentsGeometry(geometry)) {
    geometry.setPositions(buffer);
    if (geometry.attributes.instanceStart) {
      geometry.attributes.instanceStart.needsUpdate = true;
    }
    if (geometry.attributes.instanceEnd) {
      geometry.attributes.instanceEnd.needsUpdate = true;
    }
  }

  if (recomputeLineDistances) {
    const lineWithDistances = line as unknown as { computeLineDistances?: () => void };
    lineWithDistances.computeLineDistances?.();
  }

  line.visible = true;
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
  const pastConnectorRef = useRef<DreiLineRef>(null);
  const plannedConnectorRef = useRef<DreiLineRef>(null);

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

  const pastBaseLinePoints = basePastPoints.length >= 2 ? basePastPoints : EMPTY_LINE_POINTS;
  const plannedBaseLinePoints = basePlannedPoints.length >= 2 ? basePlannedPoints : EMPTY_LINE_POINTS;
  const pastConnectorBuffer = useRef(new Float32Array(6));
  const plannedConnectorBuffer = useRef(new Float32Array(6));
  const absPositionKmRef = useRef(new THREE.Vector3());
  const earthRelativePositionKmRef = useRef(new THREE.Vector3());
  const headingQuaternionRef = useRef(new THREE.Quaternion());

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

    const lastPastPoint = basePastPoints.length > 0 ? basePastPoints[basePastPoints.length - 1] : null;
    const firstPlannedPoint = basePlannedPoints.length > 0 ? basePlannedPoints[0] : null;

    updateConnectorLine(
      pastConnectorRef.current,
      lastPastPoint,
      currentPosLocalUnits,
      pastConnectorBuffer.current
    );
    updateConnectorLine(
      plannedConnectorRef.current,
      currentPosLocalUnits,
      firstPlannedPoint,
      plannedConnectorBuffer.current,
      true
    );
  });

  return (
    <group name="mission-trajectory">
      <Line
        points={pastBaseLinePoints}
        color="#00ffff"
        lineWidth={2}
        transparent
        opacity={0.6}
        frustumCulled={false}
        visible={basePastPoints.length >= 2}
      />
      <Line
        ref={pastConnectorRef}
        points={EMPTY_LINE_POINTS}
        color="#00ffff"
        lineWidth={2}
        transparent
        opacity={0.6}
        frustumCulled={false}
        visible={false}
      />
      <Line
        ref={plannedConnectorRef}
        points={EMPTY_LINE_POINTS}
        color="#00ffff"
        lineWidth={1.5}
        dashed
        dashScale={50}
        dashSize={0.5}
        gapSize={0.5}
        transparent
        opacity={0.4}
        frustumCulled={false}
        visible={false}
      />
      <Line
        points={plannedBaseLinePoints}
        color="#00ffff"
        lineWidth={1.5}
        dashed
        dashScale={50}
        dashSize={0.5}
        gapSize={0.5}
        transparent
        opacity={0.4}
        frustumCulled={false}
        visible={basePlannedPoints.length >= 2}
      />
    </group>
  );
};
