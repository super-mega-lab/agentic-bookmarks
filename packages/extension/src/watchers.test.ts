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
        const cbs: FsWatcherCallbacks = { onDidChange: [], onDidCreate: [], onDidDelete: [] };
        createdWatchers.push(cbs);
        const reg = (arr: Array<(...a: any[]) => any>) => (cb: (...a: any[]) => any) => {
          arr.push(cb);
          return { dispose() {} };
        };
        return {
          onDidChange: reg(cbs.onDidChange),
          onDidCreate: reg(cbs.onDidCreate),
          onDidDelete: reg(cbs.onDidDelete),
          dispose() {},
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
import { invalidateFileCache } from '@agentic-bookmarks/core';

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
});
