const WAKE_RETRYABLE_STATUSES = new Set([502, 503, 504]);
const DEFAULT_WAKE_RETRIES = 2;
const DEFAULT_WAKE_DELAY_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelay(attempt: number): number {
  return DEFAULT_WAKE_DELAY_MS * (attempt + 1);
}

export async function fetchUpstreamWithWakeRetry(
  url: string,
  init?: RequestInit,
  retries = DEFAULT_WAKE_RETRIES,
): Promise<Response> {
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (!WAKE_RETRYABLE_STATUSES.has(response.status) || attempt === retries) {
        return response;
      }

      lastResponse = response;
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }
    }

    await sleep(getBackoffDelay(attempt));
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError instanceof Error ? lastError : new Error('Upstream request failed during wake retry');
}
