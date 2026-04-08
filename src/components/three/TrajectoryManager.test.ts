import { describe, expect, it } from 'vitest';
import { buildFetchBodyIds } from './TrajectoryManager';

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
});

