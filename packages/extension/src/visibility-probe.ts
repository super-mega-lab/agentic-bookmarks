// ABOUTME: HTTP HEAD probe for repository visibility detection.
// ABOUTME: Determines if a remote repository URL is publicly accessible.

/**
 * Open-Source Detection - HTTP HEAD Probe
 *
 * Sends an HTTP HEAD request to a remote URL and classifies the response as
 * 'public' (2xx), 'private' (non-2xx), or 'unreachable' (timeout / network).
 * Never throws — always resolves with an HttpProbeResult.
 */

import type { openSourceDetection } from '@agentic-bookmarks/core';

type HttpProbeResult = openSourceDetection.HttpProbeResult;

/** Default probe timeout in milliseconds (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Default User-Agent header sent on every probe. */
const DEFAULT_USER_AGENT = 'agentic-bookmarks opensource-detection';

/**
 * Options for {@link probeRepoVisibility}.
 */
export interface ProbeOptions {
  /** Timeout in ms; default 30000. */
  timeoutMs?: number;
  /** External AbortSignal — composed with the internal timeout signal. */
  signal?: AbortSignal;
  /** Inject an alternate fetch impl for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Override the User-Agent header. */
  userAgent?: string;
}

/** Sentinel object used as the abort reason when our internal timeout fires. */
const TIMEOUT_REASON: { kind: 'timeout' } = { kind: 'timeout' };

/**
 * Send an HTTP HEAD request to the given URL and classify the result:
 *   - 2xx (after following redirects) → 'public'
 *   - 3xx that doesn't resolve to 2xx → 'private'
 *   - 4xx / 5xx → 'private'
 *   - timeout / DNS / network failure / abort → 'unreachable'
 *
 * Never throws — always resolves with an HttpProbeResult.
 */
export async function probeRepoVisibility(
  httpsUrl: string,
  opts: ProbeOptions = {},
): Promise<HttpProbeResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(TIMEOUT_REASON);
  }, timeoutMs);

  // Compose with external signal if provided.
  const onExternalAbort = () => {
    if (opts.signal) controller.abort(opts.signal.reason);
  };
  if (opts.signal) {
    if (opts.signal.aborted) {
      controller.abort(opts.signal.reason);
    } else {
      opts.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    const response = await fetchImpl(httpsUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': userAgent, Accept: '*/*' },
    });
    if (response.status >= 200 && response.status < 300) {
      return { status: 'public', httpStatus: response.status };
    }
    return {
      status: 'private',
      httpStatus: response.status,
      reason: `http-${response.status}`,
    };
  } catch (err) {
    const aborted = controller.signal.aborted;
    const reason = describeError(err, timedOut, aborted);
    return { status: 'unreachable', httpStatus: null, reason };
  } finally {
    clearTimeout(timer);
    if (opts.signal) {
      opts.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

/**
 * Best-effort classification of a fetch error into a short reason string.
 * Consumers use this purely for diagnostics; it is not load-bearing.
 */
function describeError(err: unknown, timedOut: boolean, aborted: boolean): string {
  if (timedOut) return 'timeout';

  // AbortError from external signal (or anywhere else). When an external caller
  // calls controller.abort(reason), fetch surfaces `reason` as the thrown
  // value — its `name` may not be 'AbortError'. Fall back to the controller's
  // aborted flag to disambiguate from a true network error.
  const name = (err as { name?: string } | null)?.name;
  if (name === 'AbortError' || aborted) return 'aborted';

  // Inspect cause chain for typical Node networking error codes.
  const code = extractErrorCode(err);
  if (code === 'ENOTFOUND') return 'dns-failure';
  if (code === 'ECONNREFUSED') return 'connection-refused';
  if (code === 'ECONNRESET') return 'connection-reset';
  if (code === 'EAI_AGAIN') return 'dns-failure';
  if (code === 'ETIMEDOUT') return 'timeout';

  // Fallback string-search for environments where cause.code isn't exposed.
  const message = (err as { message?: string } | null)?.message ?? '';
  if (message.includes('ENOTFOUND')) return 'dns-failure';
  if (message.includes('ECONNREFUSED')) return 'connection-refused';
  if (message.includes('ECONNRESET')) return 'connection-reset';

  return 'network-error';
}

/**
 * Walk the error/cause chain looking for a Node `code` property.
 */
function extractErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  // Bound the walk to avoid pathological cycles.
  for (let i = 0; i < 5 && current; i += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}
