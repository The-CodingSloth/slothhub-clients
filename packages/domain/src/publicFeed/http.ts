export const readBoundedBytes = async (
  response: Response,
  maxBytes: number,
  onOverflow: (observedBytes: number) => Error,
): Promise<Uint8Array> => {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw onOverflow(declaredLength);
  }

  if (!response.body) {
    throw new Error('Feed response body is empty');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) throw onOverflow(totalBytes);
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  const payload = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return payload;
};

/**
 * The site's host refused an automated request before it reached SlothHub.
 * Vercel marks these responses with `x-vercel-mitigated` (`challenge` or
 * `deny`); a CLI or MCP client cannot complete a browser challenge.
 */
export class FeedHostBlockedError extends Error {
  readonly code = 'feed_host_blocked' as const;
  readonly recovery =
    'SlothHub\'s host blocked this automated request, usually after a burst of requests from the same network. Wait a few minutes, then retry with fewer parallel sessions. A CLI or MCP client cannot complete a browser challenge.';

  constructor(readonly httpStatus: number, readonly mitigation: string) {
    super(`HTTP ${httpStatus}: request blocked by the host's traffic protection (x-vercel-mitigated: ${mitigation})`);
    this.name = 'FeedHostBlockedError';
  }
}

export interface FeedHttpOptions {
  timeoutMs: number;
  accept: string;
  userAgent: string;
  redirect: RequestRedirect;
  statusError: (status: number, text: string) => Error;
  timeoutError: () => Error;
  abortError: (signal: AbortSignal) => Error;
}
export const fetchFeedResponse = async <T>(
  url: string,
  signal: AbortSignal | undefined,
  options: FeedHttpOptions,
  read: (response: Response) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      signal: combined,
      redirect: options.redirect,
      headers: { accept: options.accept, 'user-agent': options.userAgent },
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const mitigation = response.headers.get('x-vercel-mitigated');
      // Header text is untrusted; keep a short token such as challenge or deny.
      if (mitigation) throw new FeedHostBlockedError(response.status, mitigation.replace(/[^a-z_-]/giu, '').slice(0, 32) || 'unknown');
      throw options.statusError(response.status, response.statusText);
    }
    return await read(response);
  } catch (error) {
    if (signal?.aborted) throw options.abortError(signal);
    if (error instanceof Error && error.name === 'AbortError') throw options.timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
};
