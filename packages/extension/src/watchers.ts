import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  readRegistry,
  getBookmarksDataRoot,
  pathsForDataFile,
  invalidateFileCache,
  invalidateRegistryCache,
  registryPathForRoot,
} from '@agentic-bookmarks/core';
import type { Logger } from './logger';
import { getMcpToExtensionQueuePaths } from './ipc-paths';

// ---------------------------------------------------------------------------
// Suppress duplicate refreshes when the sticky handler just fired
// ---------------------------------------------------------------------------
const STICKY_PULSE_SUPPRESS_MS = 300;

// ---------------------------------------------------------------------------
// Dependency interface — everything the watcher module needs from the host
// ---------------------------------------------------------------------------
export interface WatcherDeps {
  workspaceRoot: string;
  log: Logger;
  updateDecorations: () => Promise<void>;
  refreshDecorationAppearance: () => Promise<void>;
  refreshTrees: () => void;          // provider + filesGroups + settingsProvider
  refreshBookmarkTrees: () => void;  // provider + filesGroups only
  refreshCodeLens: () => void;
  revalidateAndRepaint: () => Promise<void>;
  /** Fires when the mcp-to-extension queue's pulse file is touched. */
  onMcpToExtensionPulse: () => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------
export function createWatcherManager(
  deps: WatcherDeps,
  getLastStickyRefreshAt: () => number,
) {
  const {
    workspaceRoot,
    log,
    updateDecorations,
    refreshDecorationAppearance,
    refreshTrees,
    refreshBookmarkTrees,
    refreshCodeLens,
    revalidateAndRepaint,
  } = deps;

  // Internal state — every per-file pulse/data watcher of the current batch.
  // Disposing them all is how we tear down the batch for a restart (SML-1504).
  let fileWatchers: vscode.Disposable[] = [];
  // Manager-owned long-lived watchers (registry + mcp). Torn down via dispose()
  // rather than self-registering into context.subscriptions, so the per-folder
  // set can own each manager's lifecycle in a multi-root workspace (SML-1540).
  const ownDisposables: vscode.Disposable[] = [];
  let disposed = false;

  const disposeFileWatchers = () => {
    for (const w of fileWatchers) {
      try { w.dispose(); } catch {}
    }
    fileWatchers = [];
  };

  // -------------------------------------------------------------------
  // setupWatchers — create pulse & data-file watchers for every enabled
  // registered bookmark file
  // -------------------------------------------------------------------
  const setupWatchers = async () => {
    disposeFileWatchers();

    // Respect registry watcher toggles
    const reg = await readRegistry(workspaceRoot);
    if (reg.settings && reg.settings.watchersEnabled === false) return;

    // The per-file watchers are torn down via the manager's dispose() (which the
    // per-folder set owns), not by self-registering into context.subscriptions
    // (SML-1540).

    const debounce = (fn: () => void, ms = 100) => {
      let timeout: NodeJS.Timeout;
      return () => { clearTimeout(timeout); timeout = setTimeout(fn, ms); };
    };

    const refresh = debounce(async () => {
      // Skip if sticky handler just refreshed (avoid duplicate work)
      if (Date.now() - getLastStickyRefreshAt() < STICKY_PULSE_SUPPRESS_MS) {
        log.debug('[pulse] suppressed — sticky handler just refreshed');
        return;
      }
      // Refresh both bookmark and groups trees on pulse changes
      refreshBookmarkTrees();
      refreshCodeLens();
      // Re-resolve open docs FIRST, THEN repaint — order + error guard live in
      // revalidateAndRepaint (SML-1491/1496).
      await revalidateAndRepaint();
    });

    const dataRoot = getBookmarksDataRoot(reg);
    for (const f of reg.files) {
      if (f.enabled === false || f.watch === false) continue;
      const p = pathsForDataFile(f.path, workspaceRoot, dataRoot);

      // Pulse watcher: refresh UI
      const pulseWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(path.dirname(p.pulse), path.basename(p.pulse)),
      );
      pulseWatcher.onDidChange(refresh);
      pulseWatcher.onDidCreate(refresh);
      pulseWatcher.onDidDelete(refresh);
      fileWatchers.push(pulseWatcher);

      // Data file change/create/delete watcher: invalidate the read cache when the committed
      // data file is modified, created, or removed by anything other than our own writes —
      // notably external writers (git checkout/pull/stash/rebase, manual edits) that rewrite or
      // re-create the file without bumping the gitignored .pulse, so the pulse watcher never
      // fires (SML-1502; onDidCreate added for the absent→re-created case in SML-1507). Our own
      // writes also fire here, but the shared debounced `refresh` + sticky-suppress guard
      // collapse the pulse+data double-fire into a single repaint (no flicker).
      try {
        const dataWatcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(path.dirname(p.data), path.basename(p.data)),
        );
        const onDataFileChanged = () => {
          try {
            invalidateFileCache(p as any);
          } catch (err) {
            console.error(`[setupFileWatchers] Error invalidating cache for ${p.data}:`, err);
            log.error(`[setupFileWatchers] ERROR: Failed to invalidate cache: ${err}`);
          }
          // fire-and-forget: refresh is the debounced wrapper (returns void), like the pulse watchers above
          refresh();
        };
        dataWatcher.onDidChange(onDataFileChanged);
        dataWatcher.onDidCreate(onDataFileChanged);
        dataWatcher.onDidDelete(onDataFileChanged);
        fileWatchers.push(dataWatcher);
      } catch (err) {
        console.error(`[setupFileWatchers] Error creating data file watcher for ${p.data}:`, err);
        log.error(`[setupFileWatchers] ERROR: Failed to create data file watcher: ${err}`);
      }
    }
  };

  // -------------------------------------------------------------------
  // restartWatchers — tear down and recreate all file watchers
  // (setupWatchers disposes the whole previous batch at its top)
  // -------------------------------------------------------------------
  const restartWatchers = async () => {
    await setupWatchers();
  };

  // -------------------------------------------------------------------
  // setupRegistryWatcher — watch the registry JSON for changes and
  // refresh all trees + decorations when it changes
  // -------------------------------------------------------------------
  const setupRegistryWatcher = (): vscode.Disposable => {
    const regPath = registryPathForRoot(workspaceRoot);
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(regPath), path.basename(regPath)),
    );
    const debounce = (fn: () => void, ms = 150) => {
      let t: NodeJS.Timeout;
      return () => { clearTimeout(t); t = setTimeout(fn, ms); };
    };
    const onChange = debounce(async () => {
      invalidateRegistryCache(workspaceRoot);
      // Rebuild the per-file pulse/data watchers so files added via MCP
      // (file_create / file_register / group_create) are watched without a
      // window reload (SML-1504). Reads fresh because the cache was just
      // invalidated; only rebuilds per-file watchers, not the registry
      // watcher, so there's no self-retrigger.
      // Guarded: a transient registry read failure (e.g. corrupt + no valid
      // backup) must not also suppress the tree/decoration refresh below.
      try {
        await restartWatchers();
      } catch (err) {
        log.error(`[registryWatcher] restartWatchers failed, refreshing UI anyway: ${err}`);
      }
      refreshTrees();
      await refreshDecorationAppearance();
      await updateDecorations();
    }, 150);
    watcher.onDidChange(onChange);
    watcher.onDidCreate(onChange);
    watcher.onDidDelete(onChange);
    // Tracked for manager-owned teardown (SML-1540); still returned for callers
    // (e.g. existing tests) that grab the disposable directly.
    ownDisposables.push(watcher);
    return watcher;
  };

  // -------------------------------------------------------------------
  // setupMcpToExtensionWatcher — single workspace-level watcher on the
  // mcp-to-extension queue pulse file. Fires whenever the bundled MCP
  // server appends a message (e.g. bookmark-repaired).
  // -------------------------------------------------------------------
  const setupMcpToExtensionWatcher = async (): Promise<void> => {
    const reg = await readRegistry(workspaceRoot);
    const dataRoot = getBookmarksDataRoot(reg);
    const { pulsePath } = getMcpToExtensionQueuePaths(workspaceRoot, dataRoot);
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(pulsePath), path.basename(pulsePath)),
    );
    const fire = () => { void deps.onMcpToExtensionPulse(); };
    watcher.onDidChange(fire);
    watcher.onDidCreate(fire);
    watcher.onDidDelete(fire);
    // Tracked for manager-owned teardown (SML-1540).
    ownDisposables.push(watcher);
  };

  // -------------------------------------------------------------------
  // dispose — tear down EVERY watcher this manager owns (per-file batch +
  // registry + mcp). Idempotent so the per-folder set can dispose freely on
  // folder-remove / deactivate (SML-1540). Preserves SML-1504: the whole
  // per-file batch is disposed via disposeFileWatchers().
  // -------------------------------------------------------------------
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposeFileWatchers();
    for (const d of ownDisposables) {
      try { d.dispose(); } catch {}
    }
    ownDisposables.length = 0;
  };

  return {
    setupWatchers,
    restartWatchers,
    setupRegistryWatcher,
    setupMcpToExtensionWatcher,
    dispose,
  };
}

// ---------------------------------------------------------------------------
// Per-folder watcher set — one manager per workspace folder, re-synced on
// onDidChangeWorkspaceFolders so SECONDARY folders' data/registry/mcp writes
// are watched too, and folders added/removed after activation are handled
// without a window reload (SML-1540).
// ---------------------------------------------------------------------------
export interface WatcherManagerSetDeps {
  getRoots: () => string[];
  makeDeps: (root: string) => Promise<WatcherDeps>;
  getLastStickyRefreshAt: () => number;
}

export function createWatcherManagerSet(deps: WatcherManagerSetDeps): {
  sync: () => Promise<void>;
  dispose: () => void;
  roots: () => string[];
} {
  const managers = new Map<string, ReturnType<typeof createWatcherManager>>();

  const doSync = async (): Promise<void> => {
    const roots = new Set(deps.getRoots());

    // Add managers for newly-present roots.
    for (const root of roots) {
      if (managers.has(root)) continue;
      let mgr: ReturnType<typeof createWatcherManager> | undefined;
      try {
        const d = await deps.makeDeps(root);
        mgr = createWatcherManager(d, deps.getLastStickyRefreshAt);
        managers.set(root, mgr);
        await mgr.setupWatchers();
        await mgr.setupMcpToExtensionWatcher();
        mgr.setupRegistryWatcher();
      } catch (err) {
        // makeDeps may throw before we have a logger; fall back to console.error
        // (consistent with this file's other error paths). Don't let one bad
        // folder abort the rest, and don't leave a half-set-up folder lingering.
        console.error(`[watcherManagerSet] failed to set up watchers for ${root}:`, err);
        if (mgr && managers.get(root) === mgr) {
          mgr.dispose();
          managers.delete(root);
        }
      }
    }

    // Dispose managers for roots that are no longer present.
    for (const [root, mgr] of managers) {
      if (!roots.has(root)) {
        mgr.dispose();
        managers.delete(root);
      }
    }
  };

  // Serialize sync() so an in-flight sync can't race a new one into
  // double-adding a root (SML-1540).
  let chain: Promise<void> = Promise.resolve();
  const sync = (): Promise<void> => {
    const next = chain.then(() => doSync()).catch(() => { /* swallow; doSync logs per-folder */ });
    chain = next;
    return next;
  };

  const dispose = () => {
    for (const mgr of managers.values()) {
      mgr.dispose();
    }
    managers.clear();
  };

  const roots = () => [...managers.keys()];

  return { sync, dispose, roots };
}
