import { describe, expect, it } from 'vitest';
import { parseRetryAfter } from './trajectoryRequestErrors';

const now = Date.parse('2026-11-06T12:00:00Z');
describe('Retry-After parsing', () => {
  it('interprets delay seconds and HTTP dates as absolute retry times', () => {
    expect(parseRetryAfter('1', now)).toBe(now + 1000);
    expect(parseRetryAfter(' 60 ', now)).toBe(now + 60_000);
    expect(parseRetryAfter('Fri, 06 Nov 2026 12:00:05 GMT', now)).toBe(now + 5000);
    expect(parseRetryAfter('Fri, 06 Nov 2026 11:59:00 GMT', now)).toBe(now);
    expect(parseRetryAfter('0', now)).toBe(now);
  });
  it.each([null, '', 'nonsense', '-1', '1.5', 'Infinity', '9999999999999999999999999'])('ignores invalid Retry-After %s', (header) => {
    expect(parseRetryAfter(header, now)).toBeUndefined();
  });
});
