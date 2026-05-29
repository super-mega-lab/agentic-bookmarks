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

function makeDeps(calls: string[]): WatcherDeps {
  const log = { debug() {}, info() {}, warn() {}, error() {}, trace() {} } as unknown as WatcherDeps['log'];
  return {
    workspaceRoot: '/ws',
    log,
    context: { subscriptions: [] } as any,
    updateDecorations: vi.fn(async () => { calls.push('updateDecorations'); }),
    refreshDecorationAppearance: vi.fn(async () => {}),
    refreshTrees: vi.fn(() => {}),
    refreshBookmarkTrees: vi.fn(() => { calls.push('refreshBookmarkTrees'); }),
    refreshCodeLens: vi.fn(() => { calls.push('refreshCodeLens'); }),
    revalidateAndRepaint: vi.fn(async () => { calls.push('revalidateAndRepaint'); }),
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
      const calls: string[] = [];
      const deps = makeDeps(calls);
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
      expect(calls).toContain('revalidateAndRepaint');

      // Existing refresh behavior preserved.
      expect(deps.refreshBookmarkTrees).toHaveBeenCalledTimes(1);
      expect(deps.refreshCodeLens).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
