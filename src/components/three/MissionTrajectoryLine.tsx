import React, { useMemo } from 'react';
import { Line, Sphere } from '@react-three/drei';
import { scalePositionFromKm } from '@/lib/scales';
import { MissionTrajectoryPoint } from '@/lib/missionTypes';
import { densifyWithCatmullRom } from '@/lib/catmullRom';
import { EphemerisTrajectory } from '@/lib/types';

interface MissionTrajectoryLineProps {
  past: MissionTrajectoryPoint[];
  current?: [number, number, number]; // [x, y, z] in km (Earth-relative scene frame)
  planned: MissionTrajectoryPoint[];
  smoothing?: boolean;
  velocityThreshold?: number;
}

const isValidPoint = (p: [number, number, number]) => 
  Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);

function buildSyntheticCurrentPoint(current?: [number, number, number]): MissionTrajectoryPoint | null {
  if (!current) return null;

  return {
    timestamp: 'current',
    position: {
      x: current[0],
      y: current[1],
      z: current[2],
    },
    segment: 'current' as never,
  };
}

function scaleMissionPoint(point: MissionTrajectoryPoint): [number, number, number] {
  return scalePositionFromKm(point.position.x, point.position.y, point.position.z);
}

/**
 * Renders the dedicated mission trajectory for Orion.
 * This component is Earth-relative and should be rendered inside Earth's transform group.
 */
export const MissionTrajectoryLine: React.FC<MissionTrajectoryLineProps> = ({
  past,
  current,
  planned,
  smoothing = false,
  velocityThreshold = 5, // Default threshold for burn detection in km/s change
}) => {
  const currentPoint = useMemo(() => buildSyntheticCurrentPoint(current), [current]);

  // 1. Process Past Points
  const pastPoints = useMemo(() => {
    if (past.length === 0 && !currentPoint) return [];
    
    let sourcePoints = currentPoint ? [...past, currentPoint] : [...past];
    
    if (smoothing && sourcePoints.length >= 3) {
      // Densify the points using Catmull-Rom with burn guard
      // subdivisions=4 provides a good balance of smoothness vs performance
      sourcePoints = densifyWithCatmullRom(
        sourcePoints as unknown as EphemerisTrajectory[], 
        4, 
        { velocityThreshold }
      ) as unknown as MissionTrajectoryPoint[];
    }

    const pts = sourcePoints
      .map(scaleMissionPoint)
      .filter(isValidPoint);
    
    return pts;
  }, [past, currentPoint, smoothing, velocityThreshold]);

  // 2. Process Planned Points
  const plannedPoints = useMemo(() => {
    if (planned.length === 0 && !currentPoint) return [];
    
    let sourcePoints = currentPoint ? [currentPoint, ...planned] : [...planned];

    if (smoothing && sourcePoints.length >= 3) {
      sourcePoints = densifyWithCatmullRom(
        sourcePoints as unknown as EphemerisTrajectory[], 
        4, 
        { velocityThreshold }
      ) as unknown as MissionTrajectoryPoint[];
    }

    const pts = sourcePoints
      .map(scaleMissionPoint)
      .filter(isValidPoint);
    
    return pts;
  }, [planned, currentPoint, smoothing, velocityThreshold]);

  // 3. Current Position Marker
  const currentPosScaled = useMemo(() => {
    if (!current) return null;
    const scaled = scalePositionFromKm(current[0], current[1], current[2]);
    return isValidPoint(scaled) ? scaled : null;
  }, [current]);

  return (
    <group name="mission-trajectory">
      {/* Past Trajectory - Solid Blue/Cyan line */}
      {pastPoints.length >= 2 && (
        <Line
          points={pastPoints as [number, number, number][]}
          color="#00ffff"
          lineWidth={2}
          transparent
          opacity={0.6}
          frustumCulled={false}
        />
      )}

      {/* Planned Trajectory - Dashed Cyan line */}
      {plannedPoints.length >= 2 && (
        <Line
          points={plannedPoints as [number, number, number][]}
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
      )}

      {/* Current Position Glow/Marker */}
      {currentPosScaled && (
        <Sphere position={currentPosScaled} args={[0.005, 16, 16]}>
          <meshBasicMaterial 
            color="#ffffff" 
            transparent 
            opacity={0.8} 
            depthTest={false} 
          />
        </Sphere>
      )}
    </group>
  );
};
