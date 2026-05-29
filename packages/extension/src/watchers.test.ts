// ABOUTME: Regression test for the data-file pulse refresh in watchers.ts — after a
// ABOUTME: repair-driven pulse, open documents must be re-resolved BEFORE the gutter
// ABOUTME: decorations repaint, otherwise the broken "!" overlay lingers (SML-1491).

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
    updateDecorations: vi.fn(async () => {}),
    refreshDecorationAppearance: vi.fn(async () => {}),
    refreshTrees: vi.fn(() => {}),
    refreshBookmarkTrees: vi.fn(() => {}),
    refreshCodeLens: vi.fn(() => {}),
    revalidateOpenDocuments: vi.fn(async () => {}),
    onMcpToExtensionPulse: vi.fn(),
  };
}

describe('watchers — data-file pulse refresh (SML-1491)', () => {
  beforeEach(() => {
    createdWatchers.length = 0;
    vi.clearAllMocks();
  });

  it('re-resolves open documents before repainting decorations, and still refreshes trees + codelens', async () => {
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

      expect(deps.revalidateOpenDocuments).toHaveBeenCalled();
      expect(deps.updateDecorations).toHaveBeenCalled();
      // Ordering: revalidate must run BEFORE the repaint (read straight off the
      // mocks' global invocation order — no manual call-tracking array needed).
      expect(vi.mocked(deps.revalidateOpenDocuments).mock.invocationCallOrder[0]!).toBeLessThan(
        vi.mocked(deps.updateDecorations).mock.invocationCallOrder[0]!,
      );

      // Existing refresh behavior preserved.
      expect(deps.refreshBookmarkTrees).toHaveBeenCalledTimes(1);
      expect(deps.refreshCodeLens).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still repaints decorations when revalidateOpenDocuments rejects (error caught, no unhandled rejection)', async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      // Simulate a transient resolution failure on this pulse. Set before
      // createWatcherManager, which destructures revalidateOpenDocuments.
      deps.revalidateOpenDocuments = vi.fn(async () => {
        throw new Error('revalidate boom');
      });
      const mgr = createWatcherManager(deps, () => -100000);

      await mgr.setupWatchers();
      const pulse = createdWatchers[0];
      pulse.onDidChange[0]!();
      await vi.advanceTimersByTimeAsync(100);

      // revalidate was attempted and threw; the repaint must STILL run.
      // updateDecorations being called after the throw proves the catch
      // worked (otherwise the rejection would skip it and escape unhandled).
      expect(deps.revalidateOpenDocuments).toHaveBeenCalledTimes(1);
      expect(deps.updateDecorations).toHaveBeenCalledTimes(1);
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
      // (debounced), so the repaint must NOT have happened yet.
      expect(invalidateFileCache).toHaveBeenCalledTimes(1);
      expect(deps.updateDecorations).not.toHaveBeenCalled();

      // Flush the 100ms debounce — the scheduled refresh now runs.
      await vi.advanceTimersByTimeAsync(100);
      expect(deps.revalidateOpenDocuments).toHaveBeenCalledTimes(1);
      expect(deps.updateDecorations).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
