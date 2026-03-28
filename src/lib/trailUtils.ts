import * as THREE from 'three';

/**
 * Calculates alpha for vertex colors based on index and fade mode.
 */
export function calculateTrailAlpha(index: number, totalPoints: number, fadeMode: 'tail' | 'ring'): number {
  if (totalPoints <= 1) return 1.0;

  const clampedIndex = Math.max(0, Math.min(index, totalPoints - 1));
  const normalizedIndex = clampedIndex / (totalPoints - 1);

  if (fadeMode === 'tail') {
    // Planets: Brightest at point 0 (current pos), fades to 0 at end of trail
    return 1.0 - normalizedIndex;
  }

  if (fadeMode === 'ring') {
    // Moons: Bidirectional sine-based fade to hide seams
    return Math.sin(normalizedIndex * Math.PI);
  }

  return 1.0;
}

/**
 * Interpolates a base color toward black based on alpha (1.0 = original color, 0.0 = black).
 */
export function interpolateColorWithAlpha(
  baseColor: THREE.ColorRepresentation,
  alpha: number,
  targetColor: THREE.ColorRepresentation = 0x000000
): THREE.Color {
  const clampedAlpha = Math.max(0, Math.min(alpha, 1));
  return new THREE.Color(baseColor).lerp(new THREE.Color(targetColor), 1 - clampedAlpha);
}

/**
 * Builds normalized RGB tuples for Line vertex colors (0..1 range).
 */
export function getTrailVertexColors(
  totalPoints: number,
  baseColor: THREE.ColorRepresentation,
  fadeMode: 'tail' | 'ring'
): [number, number, number][] {
  const color = new THREE.Color(baseColor);
  const colors: [number, number, number][] = new Array(totalPoints);

  for (let i = 0; i < totalPoints; i++) {
    const alpha = calculateTrailAlpha(i, totalPoints, fadeMode);
    colors[i] = [color.r * alpha, color.g * alpha, color.b * alpha];
  }

  return colors;
}
