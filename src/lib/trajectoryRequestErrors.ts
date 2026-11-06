export class TrajectoryRequestError extends Error {
  constructor(message: string, readonly status?: number, public retryAt?: number) {
    super(message);
    this.name = 'TrajectoryRequestError';
  }
}

/** A suppressed request is not a successful response with missing geometry. */
export class TrajectoryRequestDeferredError extends TrajectoryRequestError {
  constructor(retryAt: number) {
    super('Trajectory request is waiting for its retry window', undefined, retryAt);
    this.name = 'TrajectoryRequestDeferredError';
  }
}

export function getTrajectoryRetryAt(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('retryAt' in error)) return undefined;
  return typeof error.retryAt === 'number' && Number.isFinite(error.retryAt)
    ? error.retryAt : undefined;
}

/** Convert delay-seconds or an HTTP date to an absolute deadline before transport. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  let retryAt: number;
  if (/^\d+$/.test(trimmed)) {
    retryAt = now + Number(trimmed) * 1000;
  } else {
    // Avoid Date.parse interpreting malformed numeric delays as calendar dates.
    if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)) return undefined;
    retryAt = Math.max(now, Date.parse(trimmed));
  }
  return Number.isSafeInteger(retryAt) ? retryAt : undefined;
}

export function abortError(): DOMException {
  return new DOMException('AbortError', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  // AbortController/DOMException can originate in a different JS realm.
  return typeof error === 'object' && error !== null &&
    (('name' in error && error.name === 'AbortError') || ('message' in error && error.message === 'AbortError'));
}

export function isTimeoutError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'TimeoutError';
}

export function canRetryTrajectoryRequest(error: unknown): boolean {
  if (error instanceof TrajectoryRequestDeferredError) return false;
  if (isAbortError(error) || isTimeoutError(error)) return false;
  if (error instanceof TrajectoryRequestError && error.status !== undefined) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return !(typeof error === 'object' && error !== null && 'name' in error && error.name === 'SyntaxError');
}
