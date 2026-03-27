'use client';

import { useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { ViewMode, ORBIT_CONFIG } from '@/lib/scales';

// --- Types ---

interface OrbitLineProps {
  /** Semi-major axis (a) in scene units (1u = 1M km) */
  semiMajorAxis?: number;
  /** Orbital eccentricity (e) - 0=circle, closer to 1=more elliptical */
  eccentricity?: number;
  /** Orbital inclination in degrees (i) */
  inclination?: number;
  /** Longitude of ascending node in degrees (Ω) */
  longAscNode?: number;
  /** Longitude of perihelion in degrees (ϖ) */
  longPerihelion?: number;
  /** Exact trajectory points (Vector3 array) */
  points?: THREE.Vector3[];
  /** Hex color for the orbit line */
  color?: string;
  /** Base opacity value (0-1) - will be modified by viewMode */
  opacity?: number;
  /** Number of segments to approximate the ellipse */
  segments?: number;
  /** View mode affects opacity and line width */
  viewMode?: ViewMode;
}

// --- Constants ---

const DEFAULT_COLOR = '#a3cffe';
const DEFAULT_OPACITY = 0.15;
const DEFAULT_SEGMENTS = 128;
const LERP_SPEED = 3.0;

// --- Helper: Convert degrees to radians ---
function degToRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

// --- Component ---

/**
 * Renders an orbit line. 
 * If 'points' are provided, it draws a direct line (vector-based).
 * Otherwise, it uses Keplerian parameters to draw an ellipse.
 */
export function OrbitLine({
  semiMajorAxis = 0,
  eccentricity = 0,
  inclination = 0,
  longAscNode = 0,
  longPerihelion = 0,
  points: vectorPoints,
  color = DEFAULT_COLOR,
  opacity = DEFAULT_OPACITY,
  segments = DEFAULT_SEGMENTS,
  viewMode = 'didactic',
}: OrbitLineProps) {
  // Animated opacity state
  const [currentOpacity, setCurrentOpacity] = useState(opacity);

  // Target values based on viewMode
  const targetOpacity = viewMode === 'realistic'
    ? ORBIT_CONFIG.realistic.opacity
    : opacity;
  const lineWidth = viewMode === 'realistic'
    ? ORBIT_CONFIG.realistic.lineWidth
    : ORBIT_CONFIG.didactic.lineWidth;

  // Animate opacity changes
  useFrame((_, delta) => {
    const newOpacity = THREE.MathUtils.lerp(
      currentOpacity,
      targetOpacity,
      delta * LERP_SPEED
    );

    if (Math.abs(newOpacity - currentOpacity) > 0.001) {
      setCurrentOpacity(newOpacity);
    }
  });

  // Generate ellipse points with focal shift
  const keplerPoints = useMemo(() => {
    if (vectorPoints) return null;

    // 1. Calculate Semi-minor axis (b = a × √(1 - e²))
    const semiMinor = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity);

    // 2. Calculate Focal Shift (c = a × e)
    const focusOffset = semiMajorAxis * eccentricity;

    // 3. Generate base ellipse curve
    const curve = new THREE.EllipseCurve(
      0, 0,
      semiMajorAxis, semiMinor,
      0, 2 * Math.PI,
      false,
      0
    );

    const curvePoints = curve.getPoints(segments);

    // 4. Convert to 3D and apply focal shift
    return curvePoints.map(p => new THREE.Vector3(
      p.x - focusOffset,
      0,
      p.y
    ));
  }, [semiMajorAxis, eccentricity, segments, vectorPoints]);

  if (vectorPoints) {
    return (
      <Line
        points={vectorPoints}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={currentOpacity}
      />
    );
  }

  // 5. Calculate rotation angles
  const Omega = degToRad(longAscNode);
  const i = degToRad(inclination);
  const omega = degToRad(longPerihelion - longAscNode);

  return (
    <group rotation={[0, Omega, 0]}>
      <group rotation={[i, 0, 0]}>
        <group rotation={[0, omega, 0]}>
          <Line
            points={keplerPoints!}
            color={color}
            lineWidth={lineWidth}
            transparent
            opacity={currentOpacity}
          />
        </group>
      </group>
    </group>
  );
}


// --- Helper: Calculate opacity based on distance ---

/**
 * Returns an opacity value that decreases with distance.
 * @param distanceFromSun Distance in million km
 */
export function getOrbitOpacity(distanceFromSun: number): number {
  const minOpacity = 0.04;
  const maxOpacity = 0.15;

  const logMin = Math.log(50);
  const logMax = Math.log(5000);
  const logDist = Math.log(Math.max(distanceFromSun, 50));

  const t = (logDist - logMin) / (logMax - logMin);
  const clampedT = Math.max(0, Math.min(1, t));

  return maxOpacity - clampedT * (maxOpacity - minOpacity);
}
