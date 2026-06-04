import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { pathsForDataFile, type WorkspaceRegistryV1, DEFAULT_BOOKMARKS_DATA_ROOT, getDefaultLocalFilePath, getLocalDir, getCacheDir, readRegistry, readFileV2, autoRepairCandidate, editFileV2WithContext, getBookmarksDataRoot, updateBookmarkUris, toWorkspaceRelativePath, appendGitignoreLine, BOOKMARKS_LOCAL_GITIGNORE_LINE, brokenAnchorsCache, workspaceRelativeToUri, invalidateFileCache, ipc } from '@agentic-bookmarks/core';
import { QueueConsumer } from './ipc-consumer';
import { getMcpToExtensionQueuePaths } from './ipc-paths';
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
import { syncBrokenAnchorsCache, clearRegisteredUris, collectBookmarkedUris } from './brokenAnchorsSync';
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
import { AsyncMutex } from './asyncMutex';
import { markFileValidated, isFileValidated } from './scanCoverage';
import { countBroken } from './brokenCount';
import { missingFileEntries, buildAuthoritativeCache, mergeCoveredUris, pruneCoveredUris, type ScanResultEntry } from './scanValidate';
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
import { createWatcherManagerSet, type WatcherDeps } from './watchers';
import { createRevalidateAndRepaint } from './revalidate-and-repaint';
import { getBuiltinCatalog, clearCatalogCache, getCatalogCache } from './catalog-cache';
import { createAnchorResolution, resolveUriAnchors } from './anchor-resolution';
import { migrateLocalLayout } from './migrate-local-layout';
import { maybeShowGitignoreNudge } from './gitignore-nudge';
import { createScopedActivationGuard } from './scoped-activation-guard';
import { OrderingService } from './ordering/service';
import { WelcomeViewProvider } from './views/welcome/welcomeView';
import { AgentsViewProvider } from './views/agents/agentsView';
import { SKILLS } from './views/agents/agentsHtml';
import { launchAgentWithPrompt } from './commands/agent-launch';

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
  const welcomeProvider = new WelcomeViewProvider(context, context.subscriptions);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      WelcomeViewProvider.viewId,
      welcomeProvider,
      { webviewOptions: { retainContextWhenHidden: false } },
    ),
  );

  // --- Agents webview (agent connections + skill playbook launcher, workspace-agnostic) ---
  const agentsProvider = new AgentsViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AgentsViewProvider.viewId,
      agentsProvider,
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

  context.subscriptions.push(
    vscode.commands.registerCommand('agenticBookmarks.openGettingStarted', () => {
      const uri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'getting-started.md');
      void vscode.commands.executeCommand('markdown.showPreview', uri);
    }),
  );

  // Per-view help (SML-1437). Each view's title bar gets a "?" action that
  // opens a local .md as a Markdown preview. Content is initially a stub.
  const openHelpDoc = (filename: string) => () => {
    const uri = vscode.Uri.joinPath(context.extensionUri, 'resources', filename);
    void vscode.commands.executeCommand('markdown.showPreview', uri);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('agenticBookmarks.openHelp.allBookmarks',     openHelpDoc('all-bookmarks.md')),
    vscode.commands.registerCommand('agenticBookmarks.openHelp.settings',         openHelpDoc('settings.md')),
    vscode.commands.registerCommand('agenticBookmarks.openHelp.filesGroups',      openHelpDoc('files-groups.md')),
    vscode.commands.registerCommand('agenticBookmarks.openHelp.agentConnections', openHelpDoc('agent-connections.md')),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agenticBookmarks.welcome.toggleSection', async (sectionId: string) => {
      await welcomeProvider.toggleSection(sectionId);
    }),
    vscode.commands.registerCommand('agenticBookmarks.agents.toggleSection', async (sectionId: string) => {
      await agentsProvider.toggleSection(sectionId);
    }),
  );

  // --- Defer workspace-scoped activation until a folder is present (SML-1394) ---
  // Constructing providers/services against process.cwd() when no folder is open
  // writes to '/.bookmarks' and leaves the extension half-wired until reload.
  // Run the scoped phase only once a workspace folder exists, re-checking when
  // folders change so "empty window -> open folder" activates without a reload.
  // Run the scoped phase at most once *successfully*. Previously `hasScoped` was
  // committed before the await, so a rejection inside activateForWorkspace (fired
  // detached via `void`) went unhandled AND blocked any retry, leaving the extension
  // permanently half-wired. The guard surfaces the failure and resets so a later
  // folder change retries; its in-flight guard prevents a concurrent run. (SML-1532)
  const runScopedActivation = createScopedActivationGuard({
    run: () => activateForWorkspace(context, log, outputChannel, welcomeProvider, agentsProvider),
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Log the full stack (not just the message) so a half-wired activation is
      // diagnosable from the output channel (SML-1569).
      const detail = err instanceof Error && err.stack ? err.stack : msg;
      log.error(`Workspace-scoped activation failed: ${detail}`);
      void vscode.window.showErrorMessage(
        `Agentic Bookmarks: workspace activation failed — ${msg}. Open or change a workspace folder to retry, or reload the window.`,
      );
    },
  });
  const maybeActivateForWorkspace = async () => {
    if (!vscode.workspace.workspaceFolders?.length) return;
    await runScopedActivation();
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
  agentsProvider: AgentsViewProvider,
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

  // Action-row state. `scanQueueRef` and `lastBrokenIds` are assigned later (the
  // queues are built after the provider); the provider reads them lazily via thunks.
  // We hold a Set of broken IDs (not just a count) so the MCP-driven streaming
  // refresh can remove IDs one at a time as bookmark-repaired messages arrive,
  // and the displayed X/Y count is always `lastBrokenIds.size`.
  let scanQueueRef: ScanQueue | null = null;
  let lastBrokenIds = new Set<string>();

  const provider = new BookmarksProvider(
    paths, workspaceRoot, defaultIconPath, getUIState, isFileHidden, context, orderingService,
    () => ({
      scanPhase: scanQueueRef?.phase() ?? 'idle',
      scanRunningScanned: scanQueueRef?.scannedThisRun() ?? 0,
      scanRunningTotal: scanQueueRef?.totalThisRun() ?? 0,
      brokenCount: lastBrokenIds.size,
    }),
    (fsPath: string) => isFileValidated(fsPath),
  );

  // Refresh the set of broken bookmark IDs from the persisted cache across folders.
  // Only updates while the repair queue is idle, so the count doesn't flicker
  // while auto-repair is mid-flight (it leaves the last value in place until then).
  // Streaming MCP `bookmark-repaired` events decrement this set between scans.
  async function refreshBrokenIds(): Promise<void> {
    if (repairQueue && !repairQueue.isIdle()) return;
    const ids = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      try {
        const reg = await readRegistry(folder.uri.fsPath);
        const cacheDir = getCacheDir(folder.uri.fsPath, getBookmarksDataRoot(reg));
        const cache = await brokenAnchorsCache.readBrokenAnchorsCache(cacheDir);
        for (const e of cache.entries) {
          if (e.status === 'broken') ids.add(e.bookmarkId);
        }
      } catch { /* ignore folders without a cache */ }
    }
    lastBrokenIds = ids;
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
  // Serializes both in-process broken-anchors.json read-merge-write writers
  // (this sync timer + the scan-cache writer) so they can't interleave at awaits
  // and lose updates (SML-1534). Per-activation so distinct multi-root folders
  // keep independent locks.
  const brokenAnchorsCacheMutex = new AsyncMutex();
  let cacheSyncTimer: ReturnType<typeof setTimeout> | null = null;
  function debouncedCacheSync() {
    if (cacheSyncTimer) clearTimeout(cacheSyncTimer);
    cacheSyncTimer = setTimeout(async () => {
      cacheSyncTimer = null;
      const reg = await readRegistry(workspaceRoot);
      await brokenAnchorsCacheMutex.runExclusive(() =>
        syncBrokenAnchorsCache(workspaceRoot, reg, (msg) => log.debug(msg)),
      );
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
      lineCacheLength: getLineCacheLength(), // SML-1571: thread capture cap so formatter-tier substring gate uses the correct value.
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

  // Single owner of the revalidate→decorate ordering invariant (SML-1496).
  const { revalidateAndRepaint, openAndRepaint, repaintAfter } = createRevalidateAndRepaint({
    revalidateOpenDocuments,
    onFileOpened,            // the WRAPPED onFileOpened (markFileValidated), defined above
    updateDecorations,
    log,
  });

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

  // --- File, registry & MCP watchers — one manager per workspace folder ---
  // (SML-1540) A multi-root workspace gets a watcher manager per folder, each
  // with its own data/registry watchers and its own mcp-to-extension queue
  // consumer, so SECONDARY folders' external writes invalidate caches + refresh
  // the UI, and folders added/removed after activation are (un)watched without a
  // window reload. The UI-refresh callbacks below are workspace-wide and shared.

  // Streaming decrement: each successful MCP repair removes its ID from the
  // broken-ID set and re-renders the tree. Repairs of IDs that aren't in the
  // set (already healed, or never-broken) are silently ignored. Shared across
  // every folder's consumer.
  const onBookmarkRepaired = (payload: { bookmarkId?: string }) => {
    const id = payload?.bookmarkId;
    if (typeof id !== 'string') return;
    if (lastBrokenIds.delete(id)) {
      provider.refresh();
    }
  };
  const refreshAllTrees = () => { settingsProvider.refresh(); filesGroups.refresh(); provider.refresh(); };
  const refreshBookmarkTreesFn = () => { filesGroups.refresh(); provider.refresh(); };

  const makeWatcherDeps = async (root: string): Promise<WatcherDeps> => {
    // Generic one-way MCP → extension channel for this folder. Truncate on
    // activation so stale messages from a previous session don't skew the
    // in-memory state populated by the next scan.
    const dataRoot = getBookmarksDataRoot(await readRegistry(root));
    const { queuePath } = getMcpToExtensionQueuePaths(root, dataRoot);
    await ipc.truncateQueue(queuePath);
    const consumer = new QueueConsumer(queuePath, {
      log,
      handlers: { 'bookmark-repaired': onBookmarkRepaired },
    });
    return {
      workspaceRoot: root,
      log,
      updateDecorations,
      refreshDecorationAppearance,
      refreshTrees: refreshAllTrees,
      refreshBookmarkTrees: refreshBookmarkTreesFn,
      refreshCodeLens: () => codeLensProvider.refresh(),
      revalidateAndRepaint,
      onMcpToExtensionPulse: () => consumer.drain(),
    };
  };

  const watcherSet = createWatcherManagerSet({
    getRoots: () => (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath),
    makeDeps: makeWatcherDeps,
    getLastStickyRefreshAt: sticky.getLastStickyRefreshAt,
  });
  await watcherSet.sync();
  context.subscriptions.push({ dispose: () => watcherSet.dispose() });
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void watcherSet.sync(); }),
  );

  // --- Document lifecycle ---
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(openAndRepaint)
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
      // picks up its bookmarks under the new URI immediately, then repaint.
      await revalidateAndRepaint();
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
      provider,
      filesGroups,
      settingsProvider,
      settingsView,
      codeLensProvider,
      updateDecorations,
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
      revalidateAndRepaint,
      getUIState,
      setUIState,
      getCatalogCache,
      refreshWelcomeView: () => { welcomeProvider.refresh(); agentsProvider.refresh(); },
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
  // N:1 (resolve-many → paint-once) routed through the invariant helper so the
  // resolve→repaint order and the resolve/repaint guards hold here too (SML-1499).
  await repaintAfter(async () => {
    for (const editor of vscode.window.visibleTextEditors) {
      await onFileOpened(editor.document);
    }
  }, 'activation: initialize anchor state for open documents');

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
    applyRepair: (bookmarkId: string, candidateLine: number, fileLines?: string[]) =>
      applyAutoRepairCandidate(bookmarkId, candidateLine, workspaceRoot, getLineCacheLength, fileLines),
    updateAnchorState,
    updateDeepFlexState,
    refreshUI: () => { void refreshBrokenIds().then(() => provider.refresh()); debouncedCacheSync(); },
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
  //
  // Invalidates core's in-memory data-file cache first: that cache is keyed by a
  // pulse-file mtime that only moves on extension writes, so an external mutation
  // (e.g. `git checkout` swapping the committed .bookmarks data files) would
  // otherwise serve stale anchors and the scan would re-report the old state. A
  // scan is an explicit "re-check disk" action, so we always read the store fresh.
  async function collectAllBookmarkedTargets(): Promise<ScanTarget[]> {
    const reg = await readRegistry(workspaceRoot);
    const dataRoot = getBookmarksDataRoot(reg);
    const seen = new Map<string, ScanTarget>();
    for (const rf of reg.files.filter((f) => f.enabled !== false)) {
      try {
        const paths = pathsForDataFile(rf.path, workspaceRoot, dataRoot);
        invalidateFileCache(paths); // drop stale cache before the fresh read (repopulates)
        const file = await readFileV2(paths);
        for (const b of file.bookmarks) {
          const uri = b.target.uri.split('#')[0];
          const fsPath = targetUriToFsPath(uri);
          const existing = seen.get(fsPath);
          if (existing) existing.bookmarkCount++;
          else seen.set(fsPath, { fsPath, uri, bookmarkCount: 1 });
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
    // Share the broken-anchors.json mutex with debouncedCacheSync so the
    // read-merge-write below can't interleave with the sync writer (SML-1534).
    return brokenAnchorsCacheMutex.runExclusive(async () => {
      const reg = await readRegistry(workspaceRoot);
      const cacheDir = getCacheDir(workspaceRoot, getBookmarksDataRoot(reg));
      const existing = await brokenAnchorsCache.readBrokenAnchorsCache(cacheDir);
      const merged = buildAuthoritativeCache(existing.entries, scannedUris, entries, Date.now());
      // scannedUris is exactly the set of files validated this scan — accumulate it.
      let coveredUris = mergeCoveredUris(existing.coveredUris ?? [], scannedUris);
      // Then drop coverage for files no longer bookmarked so the set stays bounded (SML-1509).
      // Skip when the universe read is unreliable (a data file failed to load) to avoid dropping
      // coverage for a momentarily-unreadable file.
      const { uris, reliable } = await collectBookmarkedUris(workspaceRoot, reg);
      if (reliable) coveredUris = pruneCoveredUris(coveredUris, uris);
      await brokenAnchorsCache.writeBrokenAnchorsCache(cacheDir, merged, coveredUris);
    });
  }

  // --- Background scan queue (validates from disk; reuses repair queue to finalize) ---
  const scanQueue = new ScanQueue({
    validateFile: validateScanFile,
    writeAuthoritativeCache: writeAuthoritativeScanCache,
    markValidated: (fsPath: string) => markFileValidated(fsPath),
    autoRepairEnabled: () => vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepair', true),
    triggerRepair: async (target: ScanTarget) => {
      // Open (no tab), then resolve + enqueue directly via openAndRepaint rather
      // than relying on the deferred onDidOpenTextDocument event: that event does
      // not re-fire for already-open docs, and even for fresh opens it fires after
      // this returns, racing the scan's idle-wait. openAndRepaint resolves anchors
      // (populating broken state) and enqueues the doc into the repair queue
      // (anchor-resolution.ts), making it observably non-idle before we poll (SML-1541).
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target.fsPath));
      await openAndRepaint(doc);
    },
    isRepairIdle: () => repairQueue?.isIdle() ?? true,
    onPhaseChange: () => provider.refresh(),
    delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    log: (m: string) => log.debug(m),
  });
  scanQueueRef = scanQueue;

  // Seed the broken-count badge from the persisted cache on activation.
  void refreshBrokenIds().then(() => provider.refresh());

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
      await refreshBrokenIds();
      provider.refresh();
    }),
    ...registerAgentRepairCommands({ context, workspaceRoot, log, getBrokenCount: () => lastBrokenIds.size }),
    vscode.commands.registerCommand('agenticBookmarks.runSkill', async (skillId: string) => {
      const skill = SKILLS.find((s) => s.id === skillId);
      if (!skill) {
        log.error(`[runSkill] unknown skill id: ${skillId}`);
        return;
      }
      await launchAgentWithPrompt({ context, workspaceRoot, log }, skill.prompt);
    }),
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
      // Conditional resolve (only the first time we see this doc) but always
      // repaint — routed through the invariant helper so the order and the
      // resolve/repaint guards hold (SML-1499). openAndRepaint can't express
      // this shape because it always resolves.
      await repaintAfter(async () => {
        if (!hasStateForFile(docUri)) {
          await onFileOpened(ed.document);
        }
      }, `onDidChangeActiveTextEditor(${ed.document.uri})`);
    })
  );

  // --- Source file save → re-validate anchors + context refresh ---
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (doc.uri.scheme !== 'file') return;
      const docUri = doc.uri.toString();
      if (!hasStateForFile(docUri)) return;
      // Resolve-one → repaint, via the invariant helper (SML-1499).
      await openAndRepaint(doc);
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
  // Surface the Output channel automatically only when developing the extension,
  // and never steal focus: end users shouldn't get the panel popped on activation (SML-1533).
  if (context.extensionMode !== vscode.ExtensionMode.Production) {
    outputChannel.show(true);
  }
}

// ---------------------------------------------------------------------------
// deactivate
// ---------------------------------------------------------------------------

export function deactivate() {
  cleanupPickMode();
  console.log('Agentic Bookmarks extension deactivated');
}
