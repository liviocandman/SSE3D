import { describe, expect, it } from 'vitest';
import { buildFetchBodyIds } from './TrajectoryManager';

describe('TrajectoryManager helpers', () => {
  it('should include core planets by default', () => {
    const ids = buildFetchBodyIds([]);
    // Default includes 8 core planets + 4 Jupiter moons + 7 Saturn moons = 19 IDs
    expect(ids).toEqual([
      '199', '299', '399', '499', '599', '699', '799', '899', // Core
      '501', '502', '503', '504',                             // Jupiter moons
      '601', '602', '603', '604', '605', '606', '608'          // Saturn moons
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

