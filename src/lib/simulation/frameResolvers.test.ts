import { beforeEach, describe, expect, it } from 'vitest';
import { useSolarStore } from '@/store/solarStore';
import { buildTrajectorySegments } from '@/lib/trajectoryEngine';
import { resolveCoveredTargetPosition } from './frameResolvers';

const START = Date.parse('2026-01-01T00:00:00Z');
function segments(seconds: number[], offset = 0, bodyId = '399') {
  return buildTrajectorySegments(seconds.map((second) => ({
    timestamp: new Date(START + second * 1000).toISOString(),
    position: { x: offset + second, y: 0, z: 0 },
  })), bodyId);
}

describe('covered travel targets', () => {
  beforeEach(() => useSolarStore.setState({ masterTrajectorySegments: {} }));

  it.each([
    ['missing', []], ['before coverage', [10, 20]],
    ['after coverage', [-20, -10]], ['gap', [0, 1, 2, 8, 9, 10]],
  ] as const)('rejects an absolute moon destination when parent data is %s', (_, seconds) => {
    useSolarStore.setState({ masterTrajectorySegments: {
      '301': segments([0, 10], 100, '301'), '399': segments([...seconds], 1000),
    } });
    expect(resolveCoveredTargetPosition('301', START + 5000)).toBeNull();
  });

  it.each([
    ['missing', []], ['before coverage', [10, 20]],
    ['after coverage', [-20, -10]], ['gap', [0, 1, 2, 8, 9, 10]],
  ] as const)('rejects a moon destination when its own data is %s', (_, seconds) => {
    useSolarStore.setState({ masterTrajectorySegments: {
      '301': segments([...seconds], 100, '301'), '399': segments([0, 10], 1000),
    } });
    expect(resolveCoveredTargetPosition('301', START + 5000)).toBeNull();
  });

  it.each([0, 5, 10])('composes parent and moon at the same covered instant, second %i', (second) => {
    useSolarStore.setState({ masterTrajectorySegments: {
      '301': segments([0, 10], 100, '301'), '399': segments([0, 10], 1000),
    } });
    expect(resolveCoveredTargetPosition('301', START + second * 1000)).toEqual({ x: 1100 + 2 * second, y: 0, z: 0 });
  });

  it('accepts a covered zero coordinate without confusing it with absent parent data', () => {
    useSolarStore.setState({ masterTrajectorySegments: {
      '301': segments([0, 10], 100, '301'), '399': segments([0, 10]),
    } });
    expect(resolveCoveredTargetPosition('301', START)).toEqual({ x: 100, y: 0, z: 0 });
  });
});
