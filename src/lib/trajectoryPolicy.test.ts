import { describe, expect, it } from 'vitest';
import { BODY_IDS } from '@/lib/types';
import {
  BASELINE_PLANET_IDS,
  buildContextualFetchBodyIds,
  buildTrajectoryRequestKey,
  getBodyFetchWindow,
} from '@/lib/trajectoryPolicy';

describe('trajectoryPolicy', () => {
  it('uses baseline planet scope when nothing is selected or hovered', () => {
    const ids = buildContextualFetchBodyIds({});
    expect(ids).toEqual(BASELINE_PLANET_IDS);
  });

  it('expands focused scope for selected planet with direct moons', () => {
    const ids = buildContextualFetchBodyIds({ selectedBodyId: BODY_IDS.JUPITER });
    expect(ids).toContain(BODY_IDS.JUPITER);
    expect(ids).toContain(BODY_IDS.IO);
    expect(ids).toContain(BODY_IDS.EUROPA);
  });

  it('does not eagerly expand hovered planet into full moon system', () => {
    const ids = buildContextualFetchBodyIds({ hoveredBodyId: BODY_IDS.SATURN });
    expect(ids).toContain(BODY_IDS.SATURN);
    expect(ids).not.toContain(BODY_IDS.TITAN);
  });

  it('adds parent body when selected body is a moon', () => {
    const ids = buildContextualFetchBodyIds({ selectedBodyId: BODY_IDS.PHOBOS });
    expect(ids).toContain(BODY_IDS.PHOBOS);
    expect(ids).toContain(BODY_IDS.MARS);
  });

  it('normalizes request key by sorting and deduping ids', () => {
    const keyA = buildTrajectoryRequestKey('2026-04-08', 7, [BODY_IDS.MARS, BODY_IDS.PHOBOS, BODY_IDS.MARS], 'mid');
    const keyB = buildTrajectoryRequestKey('2026-04-08', 7, [BODY_IDS.PHOBOS, BODY_IDS.MARS], 'mid');
    expect(keyA).toEqual(keyB);
  });

  it('returns adaptive windows for planet, moon, and rapid moon', () => {
    expect(getBodyFetchWindow(BODY_IDS.EARTH)).toEqual({ fetchSpanDays: 45, thresholdDays: 20 });
    expect(getBodyFetchWindow(BODY_IDS.MOON)).toEqual({ fetchSpanDays: 7, thresholdDays: 2 });
    expect(getBodyFetchWindow(BODY_IDS.PHOBOS)).toEqual({ fetchSpanDays: 2, thresholdDays: 0.5 });
  });
});
