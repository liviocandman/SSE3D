/**
 * Calculates alpha for vertex colors based on index and fade mode.
 */
export function calculateTrailAlpha(index: number, totalPoints: number, fadeMode: 'tail' | 'ring'): number {
  if (totalPoints <= 1) return 1.0;
  
  if (fadeMode === 'tail') {
    // Planets: Brightest at point 0 (current pos), fades to 0 at end of trail
    return 1.0 - index / (totalPoints - 1);
  } else if (fadeMode === 'ring') {
    // Moons: Bidirectional sine-based fade to hide seams
    return Math.sin((index / (totalPoints - 1)) * Math.PI);
  }
  
  return 1.0;
}
