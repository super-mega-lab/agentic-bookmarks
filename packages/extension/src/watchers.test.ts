// ABOUTME: Regression test for the data-file pulse refresh in watchers.ts — a repair-driven
// ABOUTME: pulse routes anchor re-resolution + repaint through the centralized
// ABOUTME: revalidateAndRepaint (its ordering + error guard are unit-tested in
// ABOUTME: revalidate-and-repaint.test.ts); here we assert it's invoked alongside the tree refreshes.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Capture the callbacks registered on each created FileSystemWatcher -----
type FsWatcherCallbacks = {
  onDidChange: Array<(...a: any[]) => any>;
  onDidCreate: Array<(...a: any[]) => any>;
  onDidDelete: Array<(...a: any[]) => any>;
  disposed?: boolean;
};
const createdWatchers: FsWatcherCallbacks[] = [];

vi.mock('vscode', () => {
  class RelativePattern {
    constructor(public base: string, public pattern: string) {}
  }
  return {
    RelativePattern,
    workspace: {
      createFileSystemWatcher: () => {
        const cbs: FsWatcherCallbacks = { onDidChange: [], onDidCreate: [], onDidDelete: [], disposed: false };
        createdWatchers.push(cbs);
        const reg = (arr: Array<(...a: any[]) => any>) => (cb: (...a: any[]) => any) => {
          arr.push(cb);
          return { dispose() {} };
        };
        return {
          onDidChange: reg(cbs.onDidChange),
          onDidCreate: reg(cbs.onDidCreate),
          onDidDelete: reg(cbs.onDidDelete),
          dispose() { cbs.disposed = true; },
        };
      },
    },
  };
});

vi.mock('@agentic-bookmarks/core', () => ({
  readRegistry: vi.fn(async () => ({
    settings: {},
    files: [{ path: 'shared/bookmarks.json', enabled: true }],
  })),
  getBookmarksDataRoot: vi.fn(() => '/ws/.bookmarks'),
  pathsForDataFile: vi.fn(() => ({
    data: '/ws/.bookmarks/shared/bookmarks.json',
    pulse: '/ws/.bookmarks/local/pulse/shared.pulse',
  })),
  invalidateFileCache: vi.fn(),
  invalidateRegistryCache: vi.fn(),
  registryPathForRoot: vi.fn(() => '/ws/.bookmarks/local/bookmarks.registry.json'),
}));

vi.mock('./ipc-paths', () => ({
  getMcpToExtensionQueuePaths: vi.fn(() => ({ pulsePath: '/ws/.bookmarks/local/mcp2ext.pulse' })),
}));

import { createWatcherManager, type WatcherDeps } from './watchers';
import { invalidateFileCache, readRegistry, invalidateRegistryCache } from '@agentic-bookmarks/core';

function makeDeps(): WatcherDeps {
  const log = { debug() {}, info() {}, warn() {}, error() {}, trace() {} } as unknown as WatcherDeps['log'];
  return {
    workspaceRoot: '/ws',
    log,
    context: { subscriptions: [] } as any,
    // Not driven by the pulse path (which routes through revalidateAndRepaint);
    // present only to satisfy WatcherDeps. The registry-watcher path that uses it
    // is not exercised here.
    updateDecorations: vi.fn(async () => {}),
    refreshDecorationAppearance: vi.fn(async () => {}),
    refreshTrees: vi.fn(() => {}),
    refreshBookmarkTrees: vi.fn(() => {}),
    refreshCodeLens: vi.fn(() => {}),
    revalidateAndRepaint: vi.fn(async () => {}),
    onMcpToExtensionPulse: vi.fn(),
  };
}

describe('watchers — data-file pulse refresh (SML-1491)', () => {
  beforeEach(() => {
    createdWatchers.length = 0;
    vi.clearAllMocks();
  });

  it('routes the pulse refresh through revalidateAndRepaint, and still refreshes trees + codelens', async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      // getLastStickyRefreshAt far in the past so the sticky-suppress guard never short-circuits.
      const mgr = createWatcherManager(deps, () => -100000);

      await mgr.setupWatchers();

      // The pulse watcher is the first watcher created per enabled file.
      expect(createdWatchers.length).toBeGreaterThan(0);
      const pulse = createdWatchers[0];
      expect(pulse.onDidChange).toHaveLength(1);

      // Simulate a repair-driven pulse, then flush the 100ms debounce + awaited work.
      pulse.onDidChange[0]!();
      await vi.advanceTimersByTimeAsync(100);

      // The centralized revalidate→decorate helper is invoked once; its internal
      // ordering + error guard are covered by revalidate-and-repaint.test.ts.
      expect(deps.revalidateAndRepaint).toHaveBeenCalledTimes(1);

      // Existing refresh behavior preserved.
      expect(deps.refreshBookmarkTrees).toHaveBeenCalledTimes(1);
      expect(deps.refreshCodeLens).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('on data-file delete, invalidates the read cache synchronously and schedules a (debounced) refresh', async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      const mgr = createWatcherManager(deps, () => -100000);

      await mgr.setupWatchers();

      // Per enabled file, setupWatchers creates the pulse watcher first (index 0)
      // and the data-file delete watcher second (index 1).
      expect(createdWatchers.length).toBeGreaterThanOrEqual(2);
      const dataWatcher = createdWatchers[1];
      expect(dataWatcher.onDidDelete).toHaveLength(1);

      // Fire the data-file delete handler.
      dataWatcher.onDidDelete[0]!();

      // Cache invalidation runs synchronously; the refresh is fire-and-forget
      // (debounced), so nothing downstream has run yet.
      expect(invalidateFileCache).toHaveBeenCalledTimes(1);
      expect(deps.revalidateAndRepaint).not.toHaveBeenCalled();

      // Flush the 100ms debounce — the scheduled refresh now runs, routing the
      // re-resolve + repaint through the centralized helper.
      await vi.advanceTimersByTimeAsync(100);
      expect(deps.revalidateAndRepaint).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('on external data-file change (git checkout/pull/stash), invalidates the read cache synchronously and schedules a (debounced) refresh (SML-1502)', async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      const mgr = createWatcherManager(deps, () => -100000);

      await mgr.setupWatchers();

      // createdWatchers[0] = pulse watcher, createdWatchers[1] = data-file watcher.
      expect(createdWatchers.length).toBeGreaterThanOrEqual(2);
      const dataWatcher = createdWatchers[1];
      // The fix wires the same invalidate+refresh handler onto onDidChange (not just onDidDelete),
      // so git-driven modifies — which never bump the pulse — still refresh the view.
      expect(dataWatcher.onDidChange).toHaveLength(1);

      // Fire the data-file change handler (an external writer modified the committed data file).
      dataWatcher.onDidChange[0]!();

      // Cache invalidation runs synchronously; the refresh is fire-and-forget (debounced).
      expect(invalidateFileCache).toHaveBeenCalledTimes(1);
      expect(deps.revalidateAndRepaint).not.toHaveBeenCalled();

      // Flush the 100ms debounce — the scheduled refresh runs, routing the re-resolve +
      // repaint through the centralized helper.
      await vi.advanceTimersByTimeAsync(100);
      expect(deps.revalidateAndRepaint).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('our own write (pulse + data change firing within the debounce window) collapses to a single refresh — no flicker (SML-1502)', async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      const mgr = createWatcherManager(deps, () => -100000);

      await mgr.setupWatchers();

      const pulse = createdWatchers[0];
      const dataWatcher = createdWatchers[1];

      // editFileV2 writes the data file AND bumps the pulse, so both watchers fire. They share
      // the single debounced `refresh` closure, so the two events must collapse into one repaint.
      dataWatcher.onDidChange[0]!();
      pulse.onDidChange[0]!();
      await vi.advanceTimersByTimeAsync(100);

      expect(deps.revalidateAndRepaint).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('watchers — registry-change watcher restart (SML-1504)', () => {
  beforeEach(() => {
    createdWatchers.length = 0;
    vi.clearAllMocks();
  });

  it('registry onChange rebuilds watchers so newly-registered files are watched (SML-1504)', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(readRegistry).mockResolvedValue({
        settings: {},
        files: [{ path: 'shared/a.json', enabled: true }],
      } as any);

      const deps = makeDeps();
      const mgr = createWatcherManager(deps, () => -100000);

      // Initial batch for file a (pulse + data).
      await mgr.setupWatchers();

      // Wire up the registry watcher and grab its callbacks (last watcher created).
      mgr.setupRegistryWatcher();
      const regCbs = createdWatchers[createdWatchers.length - 1];
      expect(regCbs.onDidChange).toHaveLength(1);

      // A new file gets registered via MCP.
      vi.mocked(readRegistry).mockResolvedValue({
        settings: {},
        files: [
          { path: 'shared/a.json', enabled: true },
          { path: 'shared/b.json', enabled: true },
        ],
      } as any);

      const countBefore = createdWatchers.length;

      // Fire the registry change and flush the 150ms debounce.
      regCbs.onDidChange[0]!();
      await vi.advanceTimersByTimeAsync(150);

      expect(invalidateRegistryCache).toHaveBeenCalled();

      // Rebuild created watchers for BOTH files: 2 files × (pulse + data) = 4.
      expect(createdWatchers.length - countBefore).toBe(4);

      expect(deps.refreshTrees).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restartWatchers disposes the entire previous batch — no leaked/duplicate watchers (SML-1504)', async () => {
    vi.mocked(readRegistry).mockResolvedValue({
      settings: {},
      files: [{ path: 'shared/a.json', enabled: true }],
    } as any);

    const deps = makeDeps();
    const mgr = createWatcherManager(deps, () => -100000);

    await mgr.setupWatchers();
    const batch1 = [...createdWatchers];
    expect(batch1.length).toBe(2);

    await mgr.restartWatchers();

    // Every watcher in the first batch must be disposed (old code disposed only the first).
    expect(batch1.every((w) => w.disposed)).toBe(true);

    // A fresh batch of 2 new watchers was created after the snapshot.
    expect(createdWatchers.length - batch1.length).toBe(2);
  });

  it('registry onChange still refreshes trees + decorations when the rebuild throws (SML-1504)', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(readRegistry).mockResolvedValue({
        settings: {},
        files: [{ path: 'shared/a.json', enabled: true }],
      } as any);

      const deps = makeDeps();
      const mgr = createWatcherManager(deps, () => -100000);

      await mgr.setupWatchers();
      mgr.setupRegistryWatcher();
      const regCbs = createdWatchers[createdWatchers.length - 1];

      // The rebuild's registry read fails (e.g. corrupt registry + no valid backup).
      vi.mocked(readRegistry).mockRejectedValueOnce(new Error('corrupt registry'));

      regCbs.onDidChange[0]!();
      await vi.advanceTimersByTimeAsync(150);

      // The rebuild failed, but the UI refresh must NOT be suppressed.
      expect(deps.refreshTrees).toHaveBeenCalled();
      expect(deps.refreshDecorationAppearance).toHaveBeenCalled();
      expect(deps.updateDecorations).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
