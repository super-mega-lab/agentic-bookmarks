// ABOUTME: Unit test for the centralized revalidate→decorate invariant — verifies
// ABOUTME: ordering (re-resolve THEN repaint), the error guard, and single-repaint (SML-1496).

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createRevalidateAndRepaint, type RevalidateAndRepaintDeps } from './revalidate-and-repaint';

function makeDeps(calls: string[]): RevalidateAndRepaintDeps {
  return {
    revalidateOpenDocuments: vi.fn(async () => { calls.push('revalidateOpenDocuments'); }),
    onFileOpened: vi.fn(async () => { calls.push('onFileOpened'); }),
    updateDecorations: vi.fn(async () => { calls.push('updateDecorations'); }),
    log: { error: vi.fn() },
  };
}

describe('revalidate-and-repaint — centralized revalidate→decorate invariant (SML-1496)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('revalidateAndRepaint calls revalidateOpenDocuments before updateDecorations', async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    const { revalidateAndRepaint } = createRevalidateAndRepaint(deps);

    await revalidateAndRepaint();

    expect(calls).toContain('revalidateOpenDocuments');
    expect(calls).toContain('updateDecorations');
    expect(calls.indexOf('revalidateOpenDocuments')).toBeLessThan(
      calls.indexOf('updateDecorations'),
    );
  });

  it('openAndRepaint calls onFileOpened before updateDecorations and forwards the document', async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    const { openAndRepaint } = createRevalidateAndRepaint(deps);
    const sentinelDoc = { sentinel: 'doc' } as any;

    await openAndRepaint(sentinelDoc);

    expect(calls.indexOf('onFileOpened')).toBeLessThan(
      calls.indexOf('updateDecorations'),
    );
    expect(deps.onFileOpened).toHaveBeenCalledTimes(1);
    expect(deps.onFileOpened).toHaveBeenCalledWith(sentinelDoc);
  });

  it('revalidateAndRepaint calls updateDecorations exactly once', async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    const { revalidateAndRepaint } = createRevalidateAndRepaint(deps);

    await revalidateAndRepaint();

    expect(deps.updateDecorations).toHaveBeenCalledTimes(1);
  });

  it('openAndRepaint calls updateDecorations exactly once', async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    const { openAndRepaint } = createRevalidateAndRepaint(deps);

    await openAndRepaint({} as any);

    expect(deps.updateDecorations).toHaveBeenCalledTimes(1);
  });

  it('revalidateAndRepaint still repaints (after the failed resolve) when revalidateOpenDocuments rejects', async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    deps.revalidateOpenDocuments = vi.fn(async () => {
      calls.push('revalidateOpenDocuments');
      throw new Error('revalidate boom');
    });
    const { revalidateAndRepaint } = createRevalidateAndRepaint(deps);

    // The returned promise must NOT reject (no unhandled rejection).
    await expect(revalidateAndRepaint()).resolves.toBeUndefined();

    expect(deps.revalidateOpenDocuments).toHaveBeenCalledTimes(1);
    expect(deps.updateDecorations).toHaveBeenCalledTimes(1);
    expect(deps.log.error).toHaveBeenCalledTimes(1);
    // Repaint still runs AFTER the failed resolve — ordering holds on the error path too.
    expect(calls.indexOf('revalidateOpenDocuments')).toBeLessThan(
      calls.indexOf('updateDecorations'),
    );
  });

  it('openAndRepaint still repaints (after the failed resolve) when onFileOpened rejects', async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    deps.onFileOpened = vi.fn(async () => {
      calls.push('onFileOpened');
      throw new Error('open boom');
    });
    const { openAndRepaint } = createRevalidateAndRepaint(deps);

    await expect(openAndRepaint({} as any)).resolves.toBeUndefined();

    expect(deps.onFileOpened).toHaveBeenCalledTimes(1);
    expect(deps.updateDecorations).toHaveBeenCalledTimes(1);
    expect(deps.log.error).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('onFileOpened')).toBeLessThan(
      calls.indexOf('updateDecorations'),
    );
  });

  // --- repaintAfter: the generic guarded primitive (SML-1499) ---

  it('repaintAfter runs the resolve step before updateDecorations and repaints exactly once', async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    const { repaintAfter } = createRevalidateAndRepaint(deps);

    await repaintAfter(async () => { calls.push('resolve'); }, 'custom');

    expect(calls).toEqual(['resolve', 'updateDecorations']);
    expect(deps.updateDecorations).toHaveBeenCalledTimes(1);
  });

  it('repaintAfter still repaints (after the failed resolve) without rejecting', async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    const { repaintAfter } = createRevalidateAndRepaint(deps);

    await expect(
      repaintAfter(async () => { calls.push('resolve'); throw new Error('resolve boom'); }, 'custom'),
    ).resolves.toBeUndefined();

    expect(calls).toEqual(['resolve', 'updateDecorations']);
    expect(deps.log.error).toHaveBeenCalledTimes(1);
  });

  it('repaintAfter swallows and logs a failing repaint (no unhandled rejection)', async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    deps.updateDecorations = vi.fn(async () => {
      calls.push('updateDecorations');
      throw new Error('repaint boom');
    });
    const { repaintAfter } = createRevalidateAndRepaint(deps);

    await expect(
      repaintAfter(async () => { calls.push('resolve'); }, 'custom'),
    ).resolves.toBeUndefined();

    expect(deps.updateDecorations).toHaveBeenCalledTimes(1);
    expect(deps.log.error).toHaveBeenCalledTimes(1);
  });

  it('revalidateAndRepaint does not reject when the repaint itself throws', async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    deps.updateDecorations = vi.fn(async () => { throw new Error('repaint boom'); });
    const { revalidateAndRepaint } = createRevalidateAndRepaint(deps);

    await expect(revalidateAndRepaint()).resolves.toBeUndefined();
    expect(deps.log.error).toHaveBeenCalledTimes(1);
  });
});
