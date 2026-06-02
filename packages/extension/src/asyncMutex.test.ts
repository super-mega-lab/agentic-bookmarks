// ABOUTME: Tests for AsyncMutex — FIFO non-reentrant serialization, lost-update
// ABOUTME: regression (broken-anchors race), result/rejection propagation (SML-1534).
import { describe, it, expect } from 'vitest';
import { AsyncMutex } from './asyncMutex';

/** Yield control N microtask ticks so concurrent fns can interleave deterministically. */
async function ticks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe('AsyncMutex', () => {
  it('serializes overlapping critical sections (no interleave)', async () => {
    const order: string[] = [];
    const mutex = new AsyncMutex();

    const make = (id: string) => () => (async () => {
      order.push(`enter${id}`);
      await ticks(2);
      order.push(`exit${id}`);
    })();

    // Launch both concurrently (do not await the first before queuing the second).
    const p1 = mutex.runExclusive(make('1'));
    const p2 = mutex.runExclusive(make('2'));
    await Promise.all([p1, p2]);

    expect(order).toEqual(['enter1', 'exit1', 'enter2', 'exit2']);
  });

  it('runs critical sections in FIFO call order', async () => {
    const order: number[] = [];
    const mutex = new AsyncMutex();
    const ps: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      ps.push(mutex.runExclusive(async () => {
        await ticks(1);
        order.push(i);
      }));
    }
    await Promise.all(ps);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('lost-update regression: both writers entries survive', async () => {
    const mutex = new AsyncMutex();
    const store: { value: string[] } = { value: [] };

    // Mirrors the broken-anchors read-merge-write: read, await, merge, await, write.
    const readMergeWrite = (items: string[]) => async () => {
      const read = store.value;
      await ticks(2);
      const merged = read.concat(items);
      await ticks(2);
      store.value = merged;
    };

    const a = mutex.runExclusive(readMergeWrite(['scan']));
    const b = mutex.runExclusive(readMergeWrite(['sync']));
    await Promise.all([a, b]);

    expect(store.value.sort()).toEqual(['scan', 'sync']);
  });

  it('without the mutex, an update is lost (proves the test exercises the real race)', async () => {
    const store: { value: string[] } = { value: [] };

    const readMergeWrite = async (items: string[]) => {
      const read = store.value;
      await ticks(2);
      const merged = read.concat(items);
      await ticks(2);
      store.value = merged;
    };

    // Run concurrently with NO serialization: both read the empty array, so the
    // second write clobbers the first.
    await Promise.all([readMergeWrite(['scan']), readMergeWrite(['sync'])]);

    expect(store.value.length).toBe(1);
  });

  it('returns the fn resolved value to the caller', async () => {
    const mutex = new AsyncMutex();
    const value = await mutex.runExclusive(async () => 42);
    expect(value).toBe(42);
  });

  it('propagates a fn rejection to the caller', async () => {
    const mutex = new AsyncMutex();
    await expect(
      mutex.runExclusive(async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
  });

  it('a rejecting critical section does not wedge the queue', async () => {
    const mutex = new AsyncMutex();

    const rejected = mutex.runExclusive(async () => { throw new Error('boom'); });
    await expect(rejected).rejects.toThrow('boom');

    // A subsequent critical section still runs and resolves.
    const value = await mutex.runExclusive(async () => 'ok');
    expect(value).toBe('ok');
  });
});
