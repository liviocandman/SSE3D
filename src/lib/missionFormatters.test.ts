import { describe, expect, it } from 'vitest';

import {
  formatMissionMET,
  formatSignalLatency,
  getEarthDistanceDisplay,
  getRadialVelocity,
  formatEventETA,
  formatSolarRange,
} from './missionFormatters';

describe('missionFormatters', () => {
  it('formats mission elapsed time in NASA style', () => {
    expect(formatMissionMET('2-4:3:5')).toBe('T+ 02:04:03:05');
  });

  it('switches from earth distance to altitude near Earth', () => {
    expect(getEarthDistanceDisplay(6_771)).toEqual({
      label: 'Altitude',
      value: '400',
      unit: 'km',
    });
    expect(getEarthDistanceDisplay(60_000).label).toBe('Distance from Earth');
  });

  it('formats signal latency from Earth distance', () => {
    expect(formatSignalLatency(384_400)).toBe('1.28 s');
  });

  it('computes radial velocity from Earth-relative vectors', () => {
    expect(
      getRadialVelocity(
        { x: 100_000, y: 0, z: 0 },
        { x: 2.5, y: 0, z: 0 },
      ),
    ).toEqual({
      value: '+2.50',
      unit: 'km/s',
      direction: 'Outbound',
    });
  });

  it('formats event ETA from source timestamp, not browser time', () => {
    expect(
      formatEventETA('2026-04-05T10:00:00Z', '2026-04-04T12:00:00Z'),
    ).toBe('in 22h 00m');
  });

  it('formats solar range in millions of kilometers', () => {
    expect(formatSolarRange(149_600_000)).toBe('149.6M km');
  });
});

