import { describe, expect, it } from 'vitest';
import { parseTimestampMs } from './utils';

describe('parseTimestampMs', () => {
  it('parses ISO timestamps with Z', () => {
    const value = parseTimestampMs('2026-04-08T12:34:56Z');
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBe(new Date('2026-04-08T12:34:56Z').getTime());
  });

  it('parses ISO timestamps without Z as UTC', () => {
    const value = parseTimestampMs('2026-04-08T12:34:56');
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBe(new Date('2026-04-08T12:34:56Z').getTime());
  });

  it('parses NASA/SPICE timestamps with month abbreviation', () => {
    const value = parseTimestampMs('2026-Mar-26 00:00:00');
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBe(Date.UTC(2026, 2, 26, 0, 0, 0));
  });

  it('parses NASA/SPICE timestamps case-insensitively', () => {
    const upper = parseTimestampMs('2026-MAR-26 10:11:12');
    const mixed = parseTimestampMs('2026-mAr-26 10:11:12');
    const expected = Date.UTC(2026, 2, 26, 10, 11, 12);
    expect(upper).toBe(expected);
    expect(mixed).toBe(expected);
  });

  it('returns NaN for empty input', () => {
    expect(Number.isNaN(parseTimestampMs(''))).toBe(true);
  });
});

