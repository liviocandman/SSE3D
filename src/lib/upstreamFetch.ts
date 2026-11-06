const WAKE_RETRYABLE_STATUSES = new Set([502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_WAKE_RETRIES = 2;
const WAKE_DELAY_MS = 350;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** One deadline covers every attempt, backoff and the response body. */
export async function fetchUpstreamWithWakeRetry(
  url: string,
  init: RequestInit = {},
  retries = 0,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const parentSignal = init.signal;
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  const timer = setTimeout(() => {
    controller.abort(new DOMException('Upstream deadline exceeded', 'TimeoutError'));
  }, timeoutMs);
  const cleanup = () => {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  };

  // Mutations may have committed their effects before a network failure.
  const method = (init.method ?? 'GET').toUpperCase();
  const retryLimit = method === 'GET' || method === 'HEAD'
    ? Math.min(MAX_WAKE_RETRIES, Math.max(0, Math.floor(retries) || 0))
    : 0;
  const { signal } = controller;

  try {
    for (let attempt = 0; ; attempt += 1) {
      signal.throwIfAborted();
      let response: Response;
      try {
        response = await fetch(url, { ...init, signal });
      } catch (error) {
        signal.throwIfAborted();
        if (attempt >= retryLimit) throw error;
        await sleep(WAKE_DELAY_MS * (attempt + 1), signal);
        continue;
      }

      if (WAKE_RETRYABLE_STATUSES.has(response.status) && attempt < retryLimit) {
        await response.body?.cancel();
        await sleep(WAKE_DELAY_MS * (attempt + 1), signal);
        continue;
      }

      if (!response.body) {
        cleanup();
        return response;
      }

      // Retain the deadline while Next.js streams bytes to the client.
      const reader = response.body.getReader();
      let onBodyAbort: () => void;
      const finish = () => {
        cleanup();
        signal.removeEventListener('abort', onBodyAbort);
      };
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          onBodyAbort = () => {
            stream.error(signal.reason);
            void reader.cancel(signal.reason).catch(() => {});
            finish();
          };
          signal.addEventListener('abort', onBodyAbort, { once: true });
          if (signal.aborted) onBodyAbort();
        },
        async pull(stream) {
          try {
            const { done, value } = await reader.read();
            if (signal.aborted) return;
            if (done) {
              stream.close();
              finish();
            } else {
              stream.enqueue(value);
            }
          } catch (error) {
            if (!signal.aborted) stream.error(error);
            finish();
          }
        },
        async cancel(reason) {
          finish();
          controller.abort(reason);
          await reader.cancel(reason);
        },
      });
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
  } catch (error) {
    cleanup();
    throw error;
  }
}
