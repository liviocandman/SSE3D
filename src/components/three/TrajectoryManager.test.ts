import { describe, expect, it } from 'vitest';
import { buildFetchBodyIds, buildMoonOrbitPrefetchParentIds } from '@/lib/trajectoryAvailabilityPolicy';

describe('TrajectoryManager helpers', () => {
  it('should include core planets by default', () => {
    const ids = buildFetchBodyIds([]);
    expect(ids).toEqual([
      '199', '299', '399', '499', '599', '699', '799', '899',
    ]);
  });

  it('should include selected body and its moons when available', () => {
    const ids = buildFetchBodyIds(['599']);
    expect(ids).toContain('599');
    expect(ids).toContain('501');
    expect(ids).toContain('502');
    expect(ids).toContain('503');
    expect(ids).toContain('504');
  });

  it('should prefetch moon systems for selected planet and hovered planet', () => {
    const parentIds = buildMoonOrbitPrefetchParentIds('599', null, '699');
    expect(parentIds).toContain('599');
    expect(parentIds).toContain('699');
  });

  it('should resolve selected moon to parent planet prefetch', () => {
    const parentIds = buildMoonOrbitPrefetchParentIds('501', '599', null);
    expect(parentIds).toEqual(['599']);
  });
});

