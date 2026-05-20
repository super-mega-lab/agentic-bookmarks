import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { pathsForDataFile, type WorkspaceRegistryV1, DEFAULT_BOOKMARKS_DATA_ROOT, getDefaultLocalFilePath, getLocalDir, getCacheDir, readRegistry, readFileV2, autoRepairCandidate, editFileV2WithContext, getBookmarksDataRoot, updateBookmarkUris, toWorkspaceRelativePath, appendGitignoreLine, BOOKMARKS_LOCAL_GITIGNORE_LINE, brokenAnchorsCache, workspaceRelativeToUri } from '@agentic-bookmarks/core';
import { BookmarksProvider } from './treeProvider';
import { FilesGroupsProvider } from './filesGroupsProvider';
import { SettingsProvider } from './settingsProvider';
import { LicensingService } from './licensingService';
import { TrialStore } from './trialStore';
import { createTrialMirror } from './trialMirror';
import { registerTestLicenseCommands } from './testLicenseCommands';
import { BookmarkCodeLensProvider } from './bookmarkCodeLensProvider';
import {
  getBrokenAnchors,
  getDeepFlexAnchors,
  updateAnchorState,
  updateDeepFlexState,
  clearStateForFile,
  hasStateForFile,
  classifyAnchorStatus,
} from './anchorState';
import { AnchorRepairQueue } from './repairQueue';
import { syncBrokenAnchorsCache, clearRegisteredUris } from './brokenAnchorsSync';
import { createLogger, type LogLevel } from './logger';
import {
  syncDataRootSetting, syncLoadedWorkspaceFoldersAcrossRegistries,
  getMcpWorkspaceConfig, getBookmarksForUri, getAllBookmarksForUri,
  getOpenDocumentLines, bootstrapWorkspaces,
  getDefaultTargetForWorkspace,
} from './workspace-helpers';
import { registerBookmarkCrudCommands } from './commands/bookmark-crud';
import { registerRevealInPanelCommand } from './commands/reveal-in-panel';
import { registerBookmarkJumpCommands } from './commands/bookmark-jump';
import { registerBookmarkSelectionCommands } from './commands/bookmark-selection';
import { registerBookmarkNavigationCommands, cleanupPickMode } from './commands/bookmark-navigation';
import { registerBookmarkQuickpicksCommands } from './commands/bookmark-quickpicks';
import { registerBookmarkBulkOpenCommands } from './commands/bookmark-bulk-open';
import { registerAgentRepairCommands } from './commands/agent-repair-launch';
import { ScanQueue, type ScanTarget, type ScanFileValidation } from './scanQueue';
import { markFileValidated, isFileValidated } from './scanCoverage';
import { countBroken } from './brokenCount';
import { missingFileEntries, buildAuthoritativeCache, type ScanResultEntry } from './scanValidate';
import { registerBookmarkExportCommand } from './commands/bookmark-export';
import { registerGroupManagementCommands, executeGroupMove } from './commands/group-management';
import { registerAppearanceCommands } from './commands/appearance';
import { registerViewsCommands } from './commands/views';
import { registerSettingsAndFilterCommands } from './commands/settings-and-filters';
import { registerMcpConfigAndDiagnosticsCommands } from './commands/mcp-config-and-diagnostics';
import { getOutdatedMcpInstalls, type McpInstallEntry, AGENT_DISPLAY_NAMES } from './commands/mcp-install-state';
import {
  type RepairDeps,
  getBookmarkAnchorForRepair,
  applyAutoRepairCandidate,
} from './anchor-repair-helpers';
import { createDecorationManager } from './decorations';
import { registerStickyHandler } from './sticky';
import { createWatcherManager } from './watchers';
import { getBuiltinCatalog, clearCatalogCache, getCatalogCache } from './catalog-cache';
import { createAnchorResolution, resolveUriAnchors } from './anchor-resolution';
import { migrateLocalLayout } from './migrate-local-layout';
import { maybeShowGitignoreNudge } from './gitignore-nudge';
import { OrderingService } from './ordering/service';
import { WelcomeViewProvider } from './views/welcome/welcomeView';

// ---------------------------------------------------------------------------
// activate
// ---------------------------------------------------------------------------

export async function activate(context: vscode.ExtensionContext) {
  console.log('Agentic Bookmarks extension activating...');

  // --- Logger ---
  const outputChannel = vscode.window.createOutputChannel('Agentic Bookmarks');
  const log = createLogger(outputChannel,
    vscode.workspace.getConfiguration('agenticBookmarks').get<LogLevel>('logLevel', 'error'));
  log.info('Extension activation started');
  context.subscriptions.push(outputChannel);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('agenticBookmarks.logLevel')) {
        log.setLevel(
          vscode.workspace.getConfiguration('agenticBookmarks').get<LogLevel>('logLevel', 'info')!
        );
      }
    })
  );

  // --- Welcome webview (workspace-agnostic; shows an "open a folder" CTA when empty) ---
  const welcomeProvider = new WelcomeViewProvider(context.extensionUri, context.subscriptions);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      WelcomeViewProvider.viewId,
      welcomeProvider,
      { webviewOptions: { retainContextWhenHidden: false } },
    ),
  );

  // Welcome-page "Add to .gitignore" button: append the canonical line, then
  // refresh the view so the banner clears. Detection of when to show it lives
  // in the welcome view (folder-loaded only); this command performs the write.
  context.subscriptions.push(
    vscode.commands.registerCommand('agenticBookmarks.addLocalToGitignore', async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) return;
      try {
        const status = await appendGitignoreLine(root, BOOKMARKS_LOCAL_GITIGNORE_LINE);
        log.info(`[gitignore] add-to-gitignore command: status=${status} at ${root}`);
        if (status !== 'already-present') {
          void vscode.window.showInformationMessage('Added `.bookmarks/local/` to .gitignore.');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[gitignore] add-to-gitignore command failed at ${root}: ${msg}`);
        void vscode.window.showWarningMessage(`Bookmarks: failed to update .gitignore — ${msg}`);
      } finally {
        welcomeProvider.refresh();
      }
    }),
  );

  // --- Defer workspace-scoped activation until a folder is present (SML-1394) ---
  // Constructing providers/services against process.cwd() when no folder is open
  // writes to '/.bookmarks' and leaves the extension half-wired until reload.
  // Run the scoped phase only once a workspace folder exists, re-checking when
  // folders change so "empty window -> open folder" activates without a reload.
  let hasScoped = false;
  const maybeActivateForWorkspace = async () => {
    if (hasScoped) return;
    if (!vscode.workspace.workspaceFolders?.length) return;
    hasScoped = true;
    await activateForWorkspace(context, log, outputChannel, welcomeProvider);
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void maybeActivateForWorkspace(); }),
  );
  await maybeActivateForWorkspace();

  log.info('Extension activation (agnostic phase) complete');
  console.log('Agentic Bookmarks extension ready');
}

// ---------------------------------------------------------------------------
// activateForWorkspace — workspace-scoped phase, runs once a folder is available
// ---------------------------------------------------------------------------

async function activateForWorkspace(
  context: vscode.ExtensionContext,
  log: ReturnType<typeof createLogger>,
  outputChannel: vscode.OutputChannel,
  welcomeProvider: WelcomeViewProvider,
) {
  if (!vscode.workspace.workspaceFolders?.length) {
    log.error('activateForWorkspace called with no workspace folder; skipping');
    return;
  }
  log.info('Workspace-scoped activation started');

  // --- Workspace root & default paths ---
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const defaultDataRoot = DEFAULT_BOOKMARKS_DATA_ROOT;

  // --- Migrate legacy layout (registry/icon-cache/.cache/logs) into .bookmarks/local/ ---
  // Runs before path resolution so subsequent helpers see the new layout.
  for (const folder of vscode.workspace.workspaceFolders || []) {
    try {
      await migrateLocalLayout(folder.uri.fsPath);
    } catch (err) {
      log.error(`Local-layout migration failed for ${folder.uri.fsPath}: ${err}`);
    }
  }

  // --- One-time gitignore nudge (SML-1335) ---
  // Fire-and-forget per workspace folder. Spawns `git ls-files` to detect
  // tracked files under .bookmarks/local/; if found, prompts the user once
  // (per workspace) to add the canonical ignore line.
  for (const folder of vscode.workspace.workspaceFolders || []) {
    void maybeShowGitignoreNudge({
      workspaceRoot: folder.uri.fsPath,
      workspaceState: context.workspaceState,
      log,
      showInformationMessage: (msg, ...buttons) =>
        vscode.window.showInformationMessage(msg, ...buttons),
      showWarningMessage: (msg) => vscode.window.showWarningMessage(msg),
    });
  }

  const defaultLocalPath = getDefaultLocalFilePath(workspaceRoot, defaultDataRoot);
  const paths = pathsForDataFile(defaultLocalPath, workspaceRoot, defaultDataRoot);

  // --- Bootstrap workspaces (registry init, data files, style catalogs) ---
  await bootstrapWorkspaces({ context, log, workspaceRoot, defaultDataRoot, paths });

  // --- UI state helpers ---
  type UIState = { hidden: string[]; focus: string | null; filterEnabled?: boolean; hiddenFiles?: string[] };
  type SearchFilter = { id: string; text: string; regex: boolean; op: 'AND' | 'OR' };

  function getUIState(): UIState & { searches?: SearchFilter[] } {
    return context.workspaceState.get<UIState & { searches?: SearchFilter[] }>('agenticBookmarks.ui', { hidden: [], focus: null, filterEnabled: true, searches: [], hiddenFiles: [] });
  }
  async function setUIState(next: UIState & { searches?: SearchFilter[] }) {
    await context.workspaceState.update('agenticBookmarks.ui', next);
  }

  const hiddenNotesStorageKey = 'agenticBookmarks.hiddenNoteIds';
  const hiddenNotes = new Set<string>(context.workspaceState.get<string[]>(hiddenNotesStorageKey) || []);
  const isNoteVisible = (bookmarkId: string) => !hiddenNotes.has(bookmarkId);
  async function setNoteVisibility(bookmarkId: string, visible: boolean): Promise<void> {
    if (visible) hiddenNotes.delete(bookmarkId);
    else hiddenNotes.add(bookmarkId);
    await context.workspaceState.update(hiddenNotesStorageKey, Array.from(hiddenNotes));
  }

  function isFileHidden(fileId: string, reg: WorkspaceRegistryV1): boolean {
    const ui = getUIState();
    if (ui.hiddenFiles?.includes(fileId)) return true;
    const file = reg.files.find(f => (f as any).fileId === fileId);
    return file?.enabled === false;
  }

  // --- Tree views ---
  log.debug(`Workspace root: ${workspaceRoot}`);
  log.debug(`Data path: ${paths.data}`);

  const defaultIconPath = context.asAbsolutePath('media/styles/icons/bookmark-white.svg');
  const getCatalog = () => getBuiltinCatalog(context);

  // One ordering cache per primary workspace, shared by both trees. With
  // multi-root workspaces, ranks are still stored in the primary workspace's
  // cache file — bookmark/file/group IDs are workspace-unique short ids so
  // collisions across workspaces are improbable in practice.
  // TODO: pass `knownIds` (collected from each workspace registry) to prune
  // stale entries at load time.
  const orderingCacheDir = getCacheDir(workspaceRoot);
  const orderingService = await OrderingService.load(orderingCacheDir);
  context.subscriptions.push({ dispose: () => { void orderingService.dispose(); } });

  // Action-row state. `scanQueueRef` and `lastBrokenCount` are assigned later (the
  // queues are built after the provider); the provider reads them lazily via thunks.
  let scanQueueRef: ScanQueue | null = null;
  let lastBrokenCount = 0;

  const provider = new BookmarksProvider(
    paths, workspaceRoot, defaultIconPath, getUIState, isFileHidden, context, orderingService,
    () => ({
      scanPhase: scanQueueRef?.phase() ?? 'idle',
      scanRunningScanned: scanQueueRef?.scannedThisRun() ?? 0,
      scanRunningTotal: scanQueueRef?.totalThisRun() ?? 0,
      brokenCount: lastBrokenCount,
    }),
    (fsPath: string) => isFileValidated(fsPath),
  );

  // Recompute the Repair All broken count from the persisted cache across folders.
  // Only updates while the repair queue is idle, so the number doesn't flicker
  // while auto-repair is mid-flight (it leaves the last value in place until then).
  async function recomputeBrokenCount(): Promise<void> {
    if (repairQueue && !repairQueue.isIdle()) return;
    let total = 0;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      try {
        const reg = await readRegistry(folder.uri.fsPath);
        const cacheDir = getCacheDir(folder.uri.fsPath, getBookmarksDataRoot(reg));
        const cache = await brokenAnchorsCache.readBrokenAnchorsCache(cacheDir);
        total += countBroken(cache.entries);
      } catch { /* ignore folders without a cache */ }
    }
    lastBrokenCount = total;
  }

  async function updateFilterContext() {
    try {
      const ui = getUIState();
      await vscode.commands.executeCommand('setContext', 'agenticBookmarks.filterEnabled', ui.filterEnabled === true);
    } catch (err) {
      console.error(`[updateFilterContext] Error setting VS Code context:`, err);
      log.error(`[updateFilterContext] ERROR: Failed to set context: ${err}`);
    }
  }
  await updateFilterContext();
  log.info('Tree provider created');

  const enableMultiSelectDrag = vscode.workspace.getConfiguration('agenticBookmarks').get<boolean>('dev.enableMultiSelectDrag', false);

  const treeView = vscode.window.createTreeView('agenticBookmarks.view', {
    treeDataProvider: provider,
    showCollapseAll: true,
    dragAndDropController: provider.dnd,
    canSelectMany: enableMultiSelectDrag,
  });
  context.subscriptions.push(treeView);
  log.info('Tree view registered');

  const filesGroups = new FilesGroupsProvider(workspaceRoot, getUIState, defaultIconPath, isFileHidden, context, orderingService);
  filesGroups.setGroupMoveHandler(async (groupId, srcFilePath, wsRoot, dstFileNode) => {
    try {
      const reg = await readRegistry(wsRoot);
      const dataRoot = getBookmarksDataRoot(reg);
      const p = pathsForDataFile(srcFilePath, wsRoot, dataRoot);
      const file = await readFileV2(p);
      const group = file.groups.find((g: any) => g.id === groupId);
      const groupName = group?.name ?? groupId;
      await executeGroupMove(
        { workspaceRoot: wsRoot, log, provider, filesGroups, updateDecorations },
        groupId, groupName, srcFilePath, dstFileNode.reg.path, wsRoot
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Move failed: ${e}`);
    }
  });
  const filesGroupsView = vscode.window.createTreeView('agenticBookmarks.filesGroups', {
    treeDataProvider: filesGroups,
    showCollapseAll: true,
    dragAndDropController: filesGroups.dnd,
    canSelectMany: enableMultiSelectDrag,
  });
  context.subscriptions.push(filesGroupsView);

  // --- Licensing (SML-1302 Phase 1, repo detection wired in SML-1338, trial timer in SML-1333) ---
  const trialMirror = createTrialMirror(workspaceRoot);
  const trialStore = new TrialStore(context.globalState, trialMirror);
  const licensing = new LicensingService({
    getTierSetting: () => vscode.workspace.getConfiguration('agenticBookmarks.licensing').get<string>('testTier'),
    getVisibilitySetting: () => vscode.workspace.getConfiguration('agenticBookmarks.licensing').get<string>('testVisibility'),
    setContextKey: (key, value) => { void vscode.commands.executeCommand('setContext', key, value); },
    getWorkspaceFolders: () => vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [],
    readTrialRecord: () => trialStore.read(),
    writeTrialRecord: (r) => trialStore.write(r),
    clearTrialRecord: () => trialStore.clear(),
    machineId: vscode.env.machineId,
  });
  await licensing.hydrate();
  const refreshIsDevelopment = () => {
    const enabled = vscode.workspace.getConfiguration('agenticBookmarks.licensing').get<boolean>('devCommandsEnabled') === true;
    const dev = context.extensionMode !== vscode.ExtensionMode.Production || enabled;
    void vscode.commands.executeCommand('setContext', 'agenticBookmarks.isDevelopment', dev);
  };
  refreshIsDevelopment();
  licensing.pushContext();
  // Fire-and-forget initial detection. pushContext re-runs once the cached
  // visibility settles so agenticBookmarks.repoVisibility reflects reality.
  void licensing.detect().then(() => licensing.pushContext());
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void licensing.detect(true).then(() => licensing.pushContext());
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (
        e.affectsConfiguration('agenticBookmarks.licensing.testTier') ||
        e.affectsConfiguration('agenticBookmarks.licensing.testVisibility')
      ) {
        licensing.notifyChanged();
      }
      if (e.affectsConfiguration('agenticBookmarks.licensing.devCommandsEnabled')) {
        refreshIsDevelopment();
      }
      if (e.affectsConfiguration('agenticBookmarks.sortMode.allBookmarks')) provider.refresh();
      if (e.affectsConfiguration('agenticBookmarks.sortMode.filesAndGroups')) filesGroups.refresh();
    }),
  );
  registerTestLicenseCommands(context, licensing, outputChannel);

  const settingsProvider = new SettingsProvider(workspaceRoot, context, licensing);
  const settingsView = vscode.window.createTreeView('agenticBookmarks.settings', { treeDataProvider: settingsProvider, showCollapseAll: true });
  context.subscriptions.push(settingsView);

  // --- Multi-workspace context ---
  const updateHasMultipleWorkspacesContext = () => {
    const hasMultiple = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    vscode.commands.executeCommand('setContext', 'agenticBookmarks.hasMultipleWorkspaces', hasMultiple);
  };
  updateHasMultipleWorkspacesContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => updateHasMultipleWorkspacesContext())
  );

  // --- Status bar ---
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'agenticBookmarks.showWorkspaceInfo';
  context.subscriptions.push(statusBarItem);

  async function updateStatusBar(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.length === 0) { statusBarItem.hide(); return; }
    if (folders.length === 1) {
      statusBarItem.text = `$(bookmark) ${folders[0].name}`;
      statusBarItem.tooltip = 'Bookmarks workspace';
    } else {
      statusBarItem.text = `$(bookmark) ${folders.length} workspaces`;
      statusBarItem.tooltip = folders.map(f => f.name).join('\n');
    }
    statusBarItem.show();
  }

  updateStatusBar();
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async (_e) => {
      await updateStatusBar();
      await syncLoadedWorkspaceFoldersAcrossRegistries();
      // (Style-catalog install on new folder removed in SML-1320 — catalog
      // now loads from extension media; nothing per-folder to set up.)
    })
  );

  // --- Debounced cache sync ---
  let cacheSyncTimer: ReturnType<typeof setTimeout> | null = null;
  function debouncedCacheSync() {
    if (cacheSyncTimer) clearTimeout(cacheSyncTimer);
    cacheSyncTimer = setTimeout(async () => {
      cacheSyncTimer = null;
      const reg = await readRegistry(workspaceRoot);
      await syncBrokenAnchorsCache(workspaceRoot, reg, (msg) => log.debug(msg));
    }, 1000);
  }
  context.subscriptions.push({ dispose: () => { if (cacheSyncTimer) clearTimeout(cacheSyncTimer); } });

  // --- Repair queue (created later, referenced by anchor resolution) ---
  let repairQueue: AnchorRepairQueue | null = null;

  // Resolution options from registry settings — shared by the open path and scan.
  const getResolutionOptions = async () => {
    const reg = await readRegistry(workspaceRoot);
    const anchorSettings = (reg.settings?.anchors as any) ?? {};
    return {
      enableFlexContext: anchorSettings.enableFlexContext ?? true,
      enableFlexContextShared: anchorSettings.enableFlexContextShared ?? true,
      isLocal: true, // default safe — per-bookmark isLocal is now threaded via getAllBookmarksForUri
      showWarningOnShared: anchorSettings.showWarningOnShared ?? false,
      enableLocalContextRefresh: anchorSettings.enableLocalContextRefresh ?? true,
    };
  };

  // --- Anchor resolution (onFileOpened + revalidateOpenDocuments) ---
  const { onFileOpened: rawOnFileOpened, revalidateOpenDocuments } = createAnchorResolution({
    workspaceRoot,
    log,
    getAllBookmarksForUri,
    getResolutionOptions,
    writeRefreshedAnchors: async (updates) => {
      const reg = await readRegistry(workspaceRoot);
      const dataRoot = getBookmarksDataRoot(reg);
      for (const update of updates) {
        try {
          const found = await getBookmarkAnchorForRepair(update.bookmarkId, workspaceRoot);
          if (!found) continue;
          await editFileV2WithContext(found.bookmarksDataFilePath, workspaceRoot, dataRoot, (d) => {
            const idx = d.bookmarks.findIndex((b: any) => b.id === update.bookmarkId);
            if (idx !== -1) {
              d.bookmarks[idx].anchor = update.anchor;
              d.bookmarks[idx].updatedAt = Date.now();
            }
          });
        } catch (err: any) {
          log.error(`[contextRefresh] Write failed for ${update.bookmarkId}: ${err?.message || err}`);
        }
      }
    },
    refreshTree: () => provider.refresh(),
    getRepairQueue: () => repairQueue,
    debouncedCacheSync,
  });

  // Wrap resolution so every opened/scanned file-scheme doc counts toward Scan
  // coverage, regardless of which call site (editor open, scan, rename) triggered it.
  const onFileOpened = async (document: vscode.TextDocument) => {
    await rawOnFileOpened(document);
    if (document.uri.scheme === 'file') markFileValidated(document.uri.fsPath);
  };

  // --- CodeLens ---
  const codeLensProvider = new BookmarkCodeLensProvider(
    workspaceRoot,
    (uri: string) => getBookmarksForUri(uri, workspaceRoot),
    isNoteVisible,
  );
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
  );

  // --- Decorations ---
  const { updateDecorations, refreshDecorationAppearance } = createDecorationManager({
    extensionContext: context,
    log,
    workspaceRoot,
    getUIState,
    isNoteVisible,
    getCatalog,
  });
  await refreshDecorationAppearance();

  // --- Config helpers ---
  function getLineCacheLength(): number {
    try {
      const cfg = vscode.workspace.getConfiguration('agenticBookmarks');
      const n = cfg.get<number>('lineCacheLength');
      if (typeof n === 'number' && isFinite(n) && n >= 0) return Math.floor(n);
    } catch {}
    return 80;
  }
  function getLineCacheFor(editor: vscode.TextEditor, line: number): string | undefined {
    try {
      const txt = editor.document.lineAt(line).text ?? '';
      const max = Math.max(0, getLineCacheLength());
      return txt.slice(0, max);
    } catch { return undefined; }
  }

  // --- Repair deps ---
  const repairDeps: RepairDeps = {
    workspaceRoot,
    log,
    getLineCacheLength,
    updateDecorations,
    debouncedCacheSync,
    refreshTrees: () => { provider.refresh(); filesGroups.refresh(); },
  };

  // --- Sticky bookmarks ---
  const sticky = registerStickyHandler({
    workspaceRoot,
    log,
    updateDecorations,
    getLineCacheLength,
    refreshTree: () => provider.refresh(),
    markEdited: (docUri) => repairQueue?.markEdited(docUri),
  });
  context.subscriptions.push(sticky.disposable);

  // --- File & registry watchers ---
  const watchers = createWatcherManager(
    {
      workspaceRoot,
      log,
      context,
      updateDecorations,
      refreshDecorationAppearance,
      refreshTrees: () => { settingsProvider.refresh(); filesGroups.refresh(); provider.refresh(); },
      refreshBookmarkTrees: () => { filesGroups.refresh(); provider.refresh(); },
      refreshCodeLens: () => codeLensProvider.refresh(),
      revalidateOpenDocuments,
    },
    sticky.getLastStickyRefreshAt,
  );
  await watchers.setupWatchers();
  context.subscriptions.push(watchers.setupRegistryWatcher());

  // --- Document lifecycle ---
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      await onFileOpened(document);
      await updateDecorations();
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      const docUri = document.uri.toString();
      repairQueue?.cancel(docUri);
      clearStateForFile(docUri);
      clearRegisteredUris(docUri);
      debouncedCacheSync();
    })
  );

  // --- File rename tracking ---
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles(async (e) => {
      const reg = await readRegistry(workspaceRoot);
      const dataRoot = getBookmarksDataRoot(reg);

      // Gate: skip if live rename tracking is disabled
      if (reg.settings?.anchors?.enableLiveRenameTracking === false) {
        log.debug('[rename] Live rename tracking disabled, skipping');
        return;
      }

      const renames: Array<{ oldRelPath: string; newRelPath: string }> = [];
      for (const { oldUri, newUri } of e.files) {
        const oldRel = toWorkspaceRelativePath(oldUri.fsPath, workspaceRoot);
        const newRel = toWorkspaceRelativePath(newUri.fsPath, workspaceRoot);
        if (!oldRel || !newRel) continue;

        // Detect directory renames: if the newUri is a directory, append '/'
        // so updateBookmarkUris uses prefix matching.
        try {
          const stat = await vscode.workspace.fs.stat(newUri);
          if (stat.type & vscode.FileType.Directory) {
            renames.push({
              oldRelPath: oldRel.endsWith('/') ? oldRel : oldRel + '/',
              newRelPath: newRel.endsWith('/') ? newRel : newRel + '/',
            });
            continue;
          }
        } catch {
          // stat failed — treat as file rename
        }

        renames.push({ oldRelPath: oldRel, newRelPath: newRel });
      }

      if (renames.length === 0) return;

      log.info(`[rename] Updating bookmark URIs for ${renames.length} rename(s)`);
      try {
        const result = await updateBookmarkUris(workspaceRoot, dataRoot, renames);
        if (result.updatedCount > 0) {
          log.info(`[rename] Updated ${result.updatedCount} bookmark(s)`);
        }
        for (const err of result.errors) {
          log.error(`[rename] Error in ${err.filePath}: ${err.message}`);
        }
      } catch (err) {
        log.error(`[rename] Failed to update bookmark URIs: ${err}`);
      }

      // Clear stale in-memory state keyed by old URIs.
      // Re-resolution will happen via revalidateOpenDocuments below.
      for (const { oldUri } of e.files) {
        const oldDocUri = oldUri.toString();
        repairQueue?.cancel(oldDocUri);
        clearStateForFile(oldDocUri);
        clearRegisteredUris(oldDocUri);
      }

      // Force re-resolve anchors for all open documents so the renamed file
      // picks up its bookmarks under the new URI immediately.
      await revalidateOpenDocuments();
      await updateDecorations();
    })
  );

  // --- Commands ---
  log.info('Registering commands...');
  const crudNavDeps = {
    workspaceRoot,
    log,
    provider,
    filesGroups,
    codeLensProvider,
    updateDecorations,
    debouncedCacheSync,
    getLineCacheLength,
    getLineCacheFor,
    getDefaultTargetForWorkspace: (root: string, folder: vscode.WorkspaceFolder) =>
      getDefaultTargetForWorkspace(root, folder, log),
    repairDeps,
    getUIState,
    isFileHidden,
  };
  context.subscriptions.push(
    ...registerBookmarkCrudCommands(crudNavDeps),
    ...registerRevealInPanelCommand({
      workspaceRoot,
      log,
      provider,
      treeView,
      getUIState,
      isFileHidden,
    }),
    ...registerBookmarkNavigationCommands(crudNavDeps),
    ...registerBookmarkJumpCommands({ workspaceRoot, log, getUIState, isFileHidden }),
    ...registerBookmarkSelectionCommands({ workspaceRoot, log, getUIState, isFileHidden }),
    ...registerBookmarkQuickpicksCommands({
      workspaceRoot,
      log,
      getUIState,
      isFileHidden,
      getCatalog,
      defaultIconPath,
    }),
    ...registerBookmarkBulkOpenCommands({ workspaceRoot, log, getUIState, isFileHidden }),
    ...registerBookmarkExportCommand({ workspaceRoot, log, getUIState, isFileHidden }),
    ...registerGroupManagementCommands({
      workspaceRoot,
      log,
      provider,
      filesGroups,
      updateDecorations,
      getUIState,
      setUIState,
    }),
    ...registerAppearanceCommands({
      workspaceRoot,
      log,
      context,
      provider,
      filesGroups,
      settingsProvider,
      updateDecorations,
      refreshDecorationAppearance,
      getCatalog,
      clearCatalogCache,
    }),
    ...registerViewsCommands({
      context,
      provider,
      filesGroups,
      settingsProvider,
    }),
    ...registerSettingsAndFilterCommands({
      workspaceRoot,
      log,
      paths,
      provider,
      filesGroups,
      settingsProvider,
      settingsView,
      codeLensProvider,
      updateDecorations,
      restartWatchers: () => watchers.restartWatchers(),
      getUIState,
      setUIState,
      updateFilterContext,
      isNoteVisible,
      setNoteVisibility,
    }),
    ...registerMcpConfigAndDiagnosticsCommands({
      workspaceRoot,
      log,
      context,
      outputChannel,
      paths,
      provider,
      filesGroups,
      settingsProvider,
      codeLensProvider,
      updateDecorations,
      revalidateOpenDocuments,
      getUIState,
      setUIState,
      getCatalogCache,
      refreshWelcomeView: () => welcomeProvider.refresh(),
    }),
  );

  // Fire-and-forget: show update notification if any MCP registrations are outdated.
  // Runs after commands are registered so updateMcpRegistrations is callable.
  void (async () => {
    const currentVersion = ((context as any).extension?.packageJSON?.version as string) ?? '';
    const outdated = getOutdatedMcpInstalls(context, currentVersion);
    if (outdated.length === 0) return;

    const entryLabel = (e: McpInstallEntry) => `${AGENT_DISPLAY_NAMES[e.agent]} (${e.record.scope})`;

    const buttonLabel = outdated.length === 1
      ? `Update ${entryLabel(outdated[0])}`
      : 'Update All';
    const agentList = outdated.map(entryLabel).join(', ');
    const noun = outdated.length === 1 ? 'registration' : 'registrations';
    const message = `Agentic Bookmarks updated to v${currentVersion} — ${agentList} MCP ${noun} need updating.`;

    const choice = await vscode.window.showInformationMessage(message, buttonLabel);
    if (choice === buttonLabel) {
      await vscode.commands.executeCommand('agenticBookmarks.updateMcpRegistrations');
    }
  })();

  log.info('Commands registered');

  // --- Initialize anchor state for already-open documents ---
  for (const editor of vscode.window.visibleTextEditors) {
    await onFileOpened(editor.document);
  }
  await updateDecorations();

  // --- Background repair queue ---
  repairQueue = new AnchorRepairQueue({
    getBrokenAnchors,
    getDeepFlexAnchors,
    getBookmarkAnchor: async (bookmarkId: string) => {
      const bookmarkData = await getBookmarkAnchorForRepair(bookmarkId, workspaceRoot);
      if (!bookmarkData) return null;
      return {
        anchor: bookmarkData.anchor,
        targetRelPath: bookmarkData.targetRelPath,
        workspaceRoot: bookmarkData.workspaceRoot,
        bookmarksDataFilePath: bookmarkData.bookmarksDataFilePath,
      };
    },
    findRepairCandidate: autoRepairCandidate.findRepairCandidate as any,
    applyRepair: (bookmarkId: string, candidateLine: number) =>
      applyAutoRepairCandidate(bookmarkId, candidateLine, workspaceRoot, getLineCacheLength),
    updateAnchorState,
    updateDeepFlexState,
    refreshUI: () => { void recomputeBrokenCount().then(() => provider.refresh()); debouncedCacheSync(); },
    getFileLines: getOpenDocumentLines,
    log: (msg: string) => log.debug(msg),
  });
  context.subscriptions.push(repairQueue);

  // Convert a bookmark target URI (workspace-relative or file://) to an fsPath.
  function targetUriToFsPath(uri: string): string {
    const base = uri.split('#')[0];
    if (base.startsWith('file://')) return vscode.Uri.parse(base).fsPath;
    return vscode.Uri.parse(workspaceRelativeToUri(base, workspaceRoot)).fsPath;
  }

  // Enumerate every enabled registered file's distinct target files (independent of
  // the open-files cache and UI visibility) so a scan can validate them all.
  async function collectAllBookmarkedTargets(): Promise<ScanTarget[]> {
    const reg = await readRegistry(workspaceRoot);
    const dataRoot = getBookmarksDataRoot(reg);
    const seen = new Map<string, ScanTarget>();
    for (const rf of reg.files.filter((f) => f.enabled !== false)) {
      try {
        const file = await readFileV2(pathsForDataFile(rf.path, workspaceRoot, dataRoot));
        for (const b of file.bookmarks) {
          const uri = b.target.uri.split('#')[0];
          const fsPath = targetUriToFsPath(uri);
          if (!seen.has(fsPath)) seen.set(fsPath, { fsPath, uri });
        }
      } catch (err: any) {
        log.error(`[scan] failed to read ${rf.path}: ${err?.message || err}`);
      }
    }
    return [...seen.values()];
  }

  // Validate one file from disk. Missing file → file_missing broken entries;
  // otherwise resolve via the shared resolver and classify via the shared classifier.
  async function validateScanFile(target: ScanTarget): Promise<ScanFileValidation> {
    // getAllBookmarksForUri keys off a file:// document URI (its other caller passes
    // document.uri.toString()), so look up by the canonical file:// URI built from the
    // absolute path — NOT the workspace-relative target.uri. Cache entries still record
    // the relative target.uri (the form registerBookmarkUri / anchor_listBroken use).
    const lookupUri = vscode.Uri.file(target.fsPath).toString();
    let fileLines: string[];
    try {
      const content = await fsp.readFile(target.fsPath, 'utf-8');
      fileLines = content.split('\n');
    } catch {
      const all = await getAllBookmarksForUri(lookupUri, workspaceRoot);
      return { missing: true, entries: missingFileEntries(all.map((b) => b.bookmark.id), target.uri) };
    }
    const { allBookmarks, results, isLocalMap, showWarningOnShared } = await resolveUriAnchors(
      lookupUri, fileLines, { workspaceRoot, getAllBookmarksForUri, getResolutionOptions },
    );
    // Every scan target is known to have at least one bookmark (it came from
    // collectAllBookmarkedTargets). A zero match here means a URI-key mismatch,
    // not a clean file — surface it instead of silently reporting "no breakage".
    if (allBookmarks.length === 0) {
      log.error(`[scan] no bookmarks matched for ${target.uri} (lookup ${lookupUri}) — URI key mismatch?`);
    }
    const entries: ScanResultEntry[] = results.map((r) => ({
      bookmarkId: r.anchorId,
      uri: target.uri,
      status: classifyAnchorStatus(r, { isLocal: isLocalMap.get(r.anchorId), showWarningOnShared }),
      errorCode: r.errorCode ?? null,
      errorDetails: r.errorDetails ?? null,
      score: r.score ?? null,
    }));
    return { missing: false, entries };
  }

  // Write the authoritative broken-anchor cache for the files a scan validated.
  async function writeAuthoritativeScanCache(scannedUris: Set<string>, entries: ScanResultEntry[]): Promise<void> {
    const reg = await readRegistry(workspaceRoot);
    const cacheDir = getCacheDir(workspaceRoot, getBookmarksDataRoot(reg));
    const existing = await brokenAnchorsCache.readBrokenAnchorsCache(cacheDir);
    const merged = buildAuthoritativeCache(existing.entries, scannedUris, entries, Date.now());
    await brokenAnchorsCache.writeBrokenAnchorsCache(cacheDir, merged);
  }

  // --- Background scan queue (validates from disk; reuses repair queue to finalize) ---
  const scanQueue = new ScanQueue({
    validateFile: validateScanFile,
    writeAuthoritativeCache: writeAuthoritativeScanCache,
    markValidated: (fsPath: string) => markFileValidated(fsPath),
    autoRepairEnabled: () => vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepair', true),
    triggerRepair: async (target: ScanTarget) => {
      // Open (no tab) to drive the existing auto-repair queue for this file.
      await vscode.workspace.openTextDocument(vscode.Uri.file(target.fsPath));
    },
    isRepairIdle: () => repairQueue?.isIdle() ?? true,
    onPhaseChange: () => provider.refresh(),
    delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    log: (m: string) => log.debug(m),
  });
  scanQueueRef = scanQueue;

  // Seed the broken-count badge from the persisted cache on activation.
  void recomputeBrokenCount().then(() => provider.refresh());

  // --- Scan All + agent-driven Repair All commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand('agenticBookmarks.scanAll', async () => {
      if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showWarningMessage('No workspace folder open');
        return;
      }
      if (scanQueue.isRunning()) { scanQueue.cancel(); return; } // click again = cancel
      const targets = await collectAllBookmarkedTargets();
      await scanQueue.run(targets);
      await recomputeBrokenCount();
      provider.refresh();
    }),
    ...registerAgentRepairCommands({ context, workspaceRoot, log }),
  );

  // --- Active editor change ---
  setTimeout(() => { log.info('Initial decoration update'); updateDecorations(); }, 100);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (ed) => {
      log.debug('Active editor changed, updating decorations');
      if (!ed || ed.document.uri.scheme !== 'file') {
        vscode.commands.executeCommand('setContext', 'agenticBookmarks.linesForActiveDoc', []);
        return;
      }
      const docUri = ed.document.uri.toString();
      if (!hasStateForFile(docUri)) {
        await onFileOpened(ed.document);
      }
      updateDecorations();
    })
  );

  // --- Source file save → re-validate anchors + context refresh ---
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (doc.uri.scheme !== 'file') return;
      const docUri = doc.uri.toString();
      if (!hasStateForFile(docUri)) return;
      await onFileOpened(doc);
      updateDecorations();
    })
  );

  // --- Configuration change listener ---
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('agenticBookmarks.dataRoot')) {
        for (const folder of vscode.workspace.workspaceFolders || []) {
          if (e.affectsConfiguration('agenticBookmarks.dataRoot', folder.uri)) {
            await syncDataRootSetting(folder.uri.fsPath);
            provider.refresh();
            filesGroups.refresh();
            settingsProvider.refresh();
          }
        }
      }
    })
  );

  // --- MCP server registration ---
  try {
    const vscodeLm = (vscode as any).lm;
    if (vscodeLm && typeof vscodeLm.registerMcpServerDefinitionProvider === 'function') {
      const mcpEmitter = new vscode.EventEmitter<void>();
      context.subscriptions.push(mcpEmitter);

      const serverPath = context.asAbsolutePath('server-bundle/index.js');
      log.info(`MCP server path: ${serverPath}`);

      const registration = vscodeLm.registerMcpServerDefinitionProvider('agentic_bookmarks', {
        onDidChangeMcpServerDefinitions: mcpEmitter.event,
        provideMcpServerDefinitions: async () => {
          log.debug('Providing MCP server definitions');
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? workspaceRoot;
          const workspaceConfig = getMcpWorkspaceConfig();

          if ((vscode as any).McpStdioServerDefinition) {
            log.debug('Using vscode.McpStdioServerDefinition');
            return [new (vscode as any).McpStdioServerDefinition({
              label: 'Agentic Bookmarks',
              command: process.execPath,
              args: [serverPath],
              cwd: vscode.Uri.file(context.extensionUri.fsPath),
              env: {
                BOOKMARKS_DIR: getLocalDir(workspaceFolder),
                MCP_BOOKMARKS_WORKSPACES: JSON.stringify(workspaceConfig),
              },
              version: '0.5.0',
            })];
          }

          log.debug('Using plain object for server definition');
          const definition = {
            label: 'Agentic Bookmarks',
            command: process.execPath,
            args: [serverPath],
            cwd: vscode.Uri.file(context.extensionUri.fsPath),
            env: {
              BOOKMARKS_DIR: getLocalDir(workspaceFolder),
              MCP_BOOKMARKS_WORKSPACES: JSON.stringify(workspaceConfig),
            },
            version: '0.5.0',
            type: 'stdio',
          };
          log.debug(() => `Returning definition: ${JSON.stringify({ ...definition, args: ['...'] })}`);
          return [definition];
        },
      });

      context.subscriptions.push(registration);
      log.info('MCP server provider registered successfully');
    } else {
      log.info('MCP API (vscode.lm.registerMcpServerDefinitionProvider) not available in this VS Code version');
    }
  } catch (error) {
    log.error(`Failed to register MCP server: ${error}`);
  }

  log.info('Workspace-scoped activation complete');
  outputChannel.show();
}

// ---------------------------------------------------------------------------
// deactivate
// ---------------------------------------------------------------------------

export function deactivate() {
  cleanupPickMode();
  console.log('Agentic Bookmarks extension deactivated');
}
