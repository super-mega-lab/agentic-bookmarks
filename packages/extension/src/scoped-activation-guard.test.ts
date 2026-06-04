// ABOUTME: Unit tests for createScopedActivationGuard — the one-shot async activation guard
// ABOUTME: extracted from extension.ts (SML-1532): run-once-on-success, in-flight re-entry
// ABOUTME: guard, reset-on-failure (so a later trigger retries), and never-rejects contract.

import { describe, it, expect, vi } from 'vitest';
import { createScopedActivationGuard } from './scoped-activation-guard';

// A controllable promise for driving run() timing in tests.
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createScopedActivationGuard', () => {
  it('runs at most once on success', async () => {
    const run = vi.fn(async () => {});
    const onError = vi.fn();
    const trigger = createScopedActivationGuard({ run, onError });

    await trigger();
    await trigger();
    await trigger();

    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError with the rejection and does not reject', async () => {
    const boom = new Error('activation failed');
    const run = vi.fn(async () => { throw boom; });
    const onError = vi.fn();
    const trigger = createScopedActivationGuard({ run, onError });

    // The trigger must swallow the rejection — callers fire it via `void`.
    await expect(trigger()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('retries after a failed run, then becomes a no-op once it succeeds', async () => {
    const onError = vi.fn();
    let calls = 0;
    const run = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
    });
    const trigger = createScopedActivationGuard({ run, onError });

    await trigger();                  // first attempt fails
    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    await trigger();                  // done flag was not committed → retries, succeeds
    expect(run).toHaveBeenCalledTimes(2);

    await trigger();                  // now a no-op
    expect(run).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('ignores re-entry while a run is in flight', async () => {
    const onError = vi.fn();
    const gate = deferred();
    const run = vi.fn(() => gate.promise);
    const trigger = createScopedActivationGuard({ run, onError });

    const first = trigger();          // starts the in-flight run
    await trigger();                  // concurrent trigger — must be a no-op, returns immediately
    expect(run).toHaveBeenCalledTimes(1);

    gate.resolve();
    await first;
    expect(run).toHaveBeenCalledTimes(1);

    await trigger();                  // already succeeded → no-op
    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('never rejects even when onError itself throws (SML-1569)', async () => {
    // onError is a logging callback; if IT throws, the never-rejects contract
    // must still hold (callers fire the trigger via `void`). The throw is swallowed.
    const boom = new Error('activation failed');
    const run = vi.fn(async (): Promise<void> => { throw boom; });
    const onError = vi.fn(() => { throw new Error('logger blew up'); });
    const trigger = createScopedActivationGuard({ run, onError });

    await expect(trigger()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);

    // run threw and onError's throw was swallowed → guard reset → a later run retries.
    run.mockImplementationOnce(async () => {});
    await expect(trigger()).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('resets after an in-flight run rejects, allowing a later retry', async () => {
    const onError = vi.fn();
    const gate = deferred();
    let calls = 0;
    const run = vi.fn(() => {
      calls += 1;
      return calls === 1 ? gate.promise : Promise.resolve();
    });
    const trigger = createScopedActivationGuard({ run, onError });

    const first = trigger();          // in flight
    gate.reject(new Error('late failure'));
    await first;                      // rejection surfaced via onError, guard resets
    expect(onError).toHaveBeenCalledTimes(1);

    await trigger();                  // retries and succeeds
    expect(run).toHaveBeenCalledTimes(2);
  });
});
