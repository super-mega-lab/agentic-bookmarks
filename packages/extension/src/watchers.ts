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
  context: vscode.ExtensionContext;
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
    context,
    updateDecorations,
    refreshDecorationAppearance,
    refreshTrees,
    refreshBookmarkTrees,
    refreshCodeLens,
    revalidateAndRepaint,
  } = deps;

  // Internal state — the first disposable of the current batch of watchers.
  // Disposing it is how we tear down all pulse/data watchers for a restart.
  let fsWatcher: vscode.FileSystemWatcher | null = null;

  // -------------------------------------------------------------------
  // setupWatchers — create pulse & data-file watchers for every enabled
  // registered bookmark file
  // -------------------------------------------------------------------
  const setupWatchers = async () => {
    try { fsWatcher?.dispose(); } catch {}
    fsWatcher = null;

    // Respect registry watcher toggles
    const reg = await readRegistry(workspaceRoot);
    if (reg.settings && reg.settings.watchersEnabled === false) return;

    const disposables: vscode.FileSystemWatcher[] = [];

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
      context.subscriptions.push(pulseWatcher);
      disposables.push(pulseWatcher);

      // Data file delete watcher: invalidate read cache if the data file is removed
      try {
        const dataWatcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(path.dirname(p.data), path.basename(p.data)),
        );
        dataWatcher.onDidDelete(async () => {
          try {
            invalidateFileCache(p as any);
          } catch (err) {
            console.error(`[setupFileWatchers] Error invalidating cache for ${p.data}:`, err);
            log.error(`[setupFileWatchers] ERROR: Failed to invalidate cache: ${err}`);
          }
          await refresh();
        });
        context.subscriptions.push(dataWatcher);
        disposables.push(dataWatcher);
      } catch (err) {
        console.error(`[setupFileWatchers] Error creating data file watcher for ${p.data}:`, err);
        log.error(`[setupFileWatchers] ERROR: Failed to create data file watcher: ${err}`);
      }
    }

    // keep reference to dispose all later
    if (disposables.length) fsWatcher = disposables[0];
  };

  // -------------------------------------------------------------------
  // restartWatchers — tear down and recreate all file watchers
  // -------------------------------------------------------------------
  const restartWatchers = async () => {
    try { fsWatcher?.dispose(); } catch {}
    fsWatcher = null;
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
      refreshTrees();
      await refreshDecorationAppearance();
      await updateDecorations();
    }, 150);
    watcher.onDidChange(onChange);
    watcher.onDidCreate(onChange);
    watcher.onDidDelete(onChange);
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
    context.subscriptions.push(watcher);
  };

  return {
    setupWatchers,
    restartWatchers,
    setupRegistryWatcher,
    setupMcpToExtensionWatcher,
  };
}
