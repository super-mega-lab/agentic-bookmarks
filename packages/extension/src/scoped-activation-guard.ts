// ABOUTME: One-shot async activation guard — runs a step at most once *successfully*, prevents
// ABOUTME: concurrent re-entry while it is in flight, and resets on failure so a later trigger
// ABOUTME: can retry. Extracted from extension.ts for unit testing (SML-1532).

export interface ScopedActivationGuardOptions {
  /** The activation step to run at most once successfully. */
  run: () => Promise<void>;
  /** Invoked with the rejection if `run` throws. The trigger never rethrows. */
  onError: (err: unknown) => void;
}

/**
 * Returns an idempotent trigger for a one-shot async activation step.
 *
 * - Runs `run` at most once *successfully*; once it resolves, further calls are no-ops.
 * - While a run is in flight, concurrent calls are ignored. This re-entry guard replaces
 *   the synchronous `hasScoped = true`-before-await flag it was extracted from, where a
 *   second event firing during the await could otherwise start a concurrent activation.
 * - If `run` rejects, `onError` is invoked and the guard resets (the "done" flag is never
 *   committed), so a later trigger retries. The returned promise never rejects, which makes
 *   it safe to fire via `void trigger()` from event listeners without leaking rejections.
 */
export function createScopedActivationGuard(
  options: ScopedActivationGuardOptions,
): () => Promise<void> {
  let done = false;
  let inFlight = false;
  return async () => {
    if (done || inFlight) return;
    inFlight = true;
    try {
      await options.run();
      done = true;
    } catch (err) {
      // onError is a caller-supplied callback (typically logging + a UI toast). If it
      // throws, the returned promise must still resolve — callers fire via `void trigger()`
      // and a rejection here would leak as an unhandled rejection, breaking the
      // documented never-rejects contract (SML-1569).
      try {
        options.onError(err);
      } catch {
        // Swallow: onError failing must not propagate out of the trigger.
      }
    } finally {
      inFlight = false;
    }
  };
}
