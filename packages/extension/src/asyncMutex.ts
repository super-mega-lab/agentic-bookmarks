// ABOUTME: Tiny in-process promise-chain serializer used to fence concurrent
// ABOUTME: read-merge-write critical sections (e.g. broken-anchors.json) — SML-1534.

/**
 * A minimal, dependency-free async mutex implemented as a promise chain.
 *
 * Serializes critical sections FIFO and non-reentrantly: each `runExclusive`
 * begins only after all previously-queued work has settled. Used to fence the
 * two in-process broken-anchors.json writers so their read-merge-write blocks
 * can't interleave at awaits and lose updates (SML-1534).
 */
export class AsyncMutex {
  /** Tail of the queue; resolved when no work is outstanding. */
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * Run `fn` exclusively: it begins only after all previously-queued work on
   * this mutex has settled, and the next queued fn waits for `fn` to settle.
   * Resolves/rejects with fn's outcome; a rejection is delivered to this
   * caller only and never breaks the queue for later callers. Non-reentrant.
   */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => fn());
    // Swallow the settle outcome so a rejecting critical section does not break
    // the chain for subsequent callers.
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
