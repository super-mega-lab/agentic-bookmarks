/**
 * Settings and filter commands extracted from extension.ts.
 *
 * Commands:
 *   agenticBookmarks.toggleWatchers
 *   agenticBookmarks.toggleFileWatch
 *   agenticBookmarks.toggleInlineDots
 *   agenticBookmarks.toggleNotesAndLabels
 *   agenticBookmarks.cycleDefaultAnchorType
 *   agenticBookmarks.toggleBookmarkNoteVisibility
 *   agenticBookmarks.toggleFiltering
 *   agenticBookmarks.toggleFilteringFilled
 *   agenticBookmarks.addSearchFilter
 *   agenticBookmarks.editSearchFilter
 *   agenticBookmarks.toggleSearchOp
 *   agenticBookmarks.toggleSearchRegex
 *   agenticBookmarks.removeSearchFilter
 *   agenticBookmarks.openExtensionSettings
 *   agenticBookmarks.customizeKeybindings
 *   agenticBookmarks.selectSettingsWorkspace
 */

import * as vscode from 'vscode';
import {
  readRegistry,
  writeRegistry,
  setWatchersEnabled,
  setFileWatch,
  getDefaultAnchorType,
  setDefaultAnchorType,
  ANCHOR_TYPES,
} from '@agentic-bookmarks/core';
import type { Logger } from '../logger';
import type { BookmarksProvider } from '../treeProvider';
import type { FilesGroupsProvider } from '../filesGroupsProvider';
import type { SettingsProvider } from '../settingsProvider';
import type { BookmarkCodeLensProvider } from '../bookmarkCodeLensProvider';

type UIState = { hidden: string[]; focus: string | null; filterEnabled?: boolean; hiddenFiles?: string[] };
type SearchFilter = { id: string; text: string; regex: boolean; op: 'AND' | 'OR' };

export interface SettingsAndFilterDeps {
  workspaceRoot: string;
  log: Logger;
  provider: BookmarksProvider;
  filesGroups: FilesGroupsProvider;
  settingsProvider: SettingsProvider;
  settingsView: vscode.TreeView<vscode.TreeItem>;
  codeLensProvider: BookmarkCodeLensProvider | null;
  updateDecorations: () => Promise<void>;
  getUIState: () => UIState & { searches?: SearchFilter[] };
  setUIState: (next: UIState & { searches?: SearchFilter[] }) => Promise<void>;
  updateFilterContext: () => Promise<void>;
  isNoteVisible: (bookmarkId: string) => boolean;
  setNoteVisibility: (bookmarkId: string, visible: boolean) => Promise<void>;
}

export function registerSettingsAndFilterCommands(deps: SettingsAndFilterDeps): vscode.Disposable[] {
  const {
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
  } = deps;

  return [
    // Toggle watchers
    vscode.commands.registerCommand('agenticBookmarks.toggleWatchers', async () => {
      try {
        const reg = await readRegistry(workspaceRoot);
        const enabled = !(reg.settings?.watchersEnabled);
        await setWatchersEnabled(workspaceRoot, enabled);
        settingsProvider.refresh();
        // Per-file watchers are rebuilt by the registry watcher's onChange
        // (SML-1504), which fires on this setWatchersEnabled write — no explicit
        // restartWatchers() needed here.
      } catch (e) { vscode.window.showErrorMessage(String(e)); }
    }),

    // Toggle file watch
    vscode.commands.registerCommand('agenticBookmarks.toggleFileWatch', async (filePath?: string, enabled?: boolean) => {
      try {
        if (!filePath) return;
        await setFileWatch(workspaceRoot, filePath, enabled ?? true);
        settingsProvider.refresh();
        // The setFileWatch write trips the registry watcher's onChange, which
        // rebuilds the per-file watchers for all files (SML-1504).
      } catch (e) { vscode.window.showErrorMessage(String(e)); }
    }),

    // Toggle inline dots
    vscode.commands.registerCommand('agenticBookmarks.toggleInlineDots', async () => {
      const reg = await readRegistry(workspaceRoot);
      (reg as any).settings = reg.settings || ({} as any);
      (reg as any).settings.general = reg.settings?.general || ({} as any);
      const cur = (reg as any).settings.general.showInlineDots;
      (reg as any).settings.general.showInlineDots = !(cur === true);
      await writeRegistry(workspaceRoot, reg);
      settingsProvider.refresh(); filesGroups.refresh(); provider.refresh();
      await updateDecorations();
    }),

    // Open extension settings
    vscode.commands.registerCommand('agenticBookmarks.openExtensionSettings', async () => {
      try {
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:supermegalab.agentic-bookmarks');
      } catch (err) {
        log.error(`Failed to open extension settings: ${err}`);
      }
    }),

    // Open VS Code Keyboard Shortcuts filtered to our extension
    vscode.commands.registerCommand('agenticBookmarks.customizeKeybindings', async () => {
      try {
        await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', '@ext:supermegalab.agentic-bookmarks');
      } catch (err) {
        log.error(`Failed to open keyboard shortcuts: ${err}`);
      }
    }),

    // Select settings workspace
    vscode.commands.registerCommand('agenticBookmarks.selectSettingsWorkspace', async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length <= 1) {
        return;
      }

      const items = folders.map(f => ({
        label: f.name,
        description: f.uri.fsPath,
        folder: f
      }));

      const currentRoot = settingsProvider.workspaceRoot;
      for (const item of items) {
        if (item.folder.uri.fsPath === currentRoot) {
          item.label = `$(check) ${item.label}`;
        }
      }

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select workspace folder for Settings view',
        title: 'Select Workspace'
      });

      if (selected) {
        settingsProvider.setWorkspaceRoot(selected.folder.uri.fsPath);
        settingsView.title = `Settings (${selected.folder.name})`;
      }
    }),

    // Toggle notes and labels
    vscode.commands.registerCommand('agenticBookmarks.toggleNotesAndLabels', async () => {
      const reg = await readRegistry(workspaceRoot);
      (reg as any).settings = reg.settings || ({} as any);
      (reg as any).settings.general = reg.settings?.general || ({ showInlineDots: false } as any);
      const cur = (reg as any).settings.general.showNotesAndLabels;
      (reg as any).settings.general.showNotesAndLabels = !(cur !== false);
      await writeRegistry(workspaceRoot, reg);
      settingsProvider.refresh(); filesGroups.refresh(); provider.refresh();
      await updateDecorations();
      if (codeLensProvider) {
        codeLensProvider.refresh();
      }
    }),

    // Cycle default anchor type
    vscode.commands.registerCommand('agenticBookmarks.cycleDefaultAnchorType', async () => {
      const current = await getDefaultAnchorType(workspaceRoot);
      const idx = ANCHOR_TYPES.indexOf(current as (typeof ANCHOR_TYPES)[number]);
      const next = ANCHOR_TYPES[(idx + 1) % ANCHOR_TYPES.length];
      await setDefaultAnchorType(workspaceRoot, next);
      settingsProvider.refresh();
      vscode.window.showInformationMessage(`Default anchor type set to: ${next}`);
    }),

    // Toggle bookmark note visibility
    vscode.commands.registerCommand('agenticBookmarks.toggleBookmarkNoteVisibility', async (bookmarkId?: string) => {
      if (typeof bookmarkId !== 'string' || bookmarkId.length === 0) {
        return;
      }
      const currentlyVisible = isNoteVisible(bookmarkId);
      await setNoteVisibility(bookmarkId, !currentlyVisible);
      await updateDecorations();
      if (codeLensProvider) {
        codeLensProvider.refresh();
      }
    }),

    // Toggle filtering
    vscode.commands.registerCommand('agenticBookmarks.toggleFiltering', async () => {
      const ui = getUIState();
      await setUIState({ ...ui, filterEnabled: !(ui.filterEnabled === true) });
      await updateFilterContext();
      provider.refresh();
    }),

    // Toggle filtering (filled icon alias)
    vscode.commands.registerCommand('agenticBookmarks.toggleFilteringFilled', async () => {
      const ui = getUIState();
      await setUIState({ ...ui, filterEnabled: !(ui.filterEnabled === true) });
      await updateFilterContext();
      provider.refresh();
    }),

    // Add search filter
    vscode.commands.registerCommand('agenticBookmarks.addSearchFilter', async (_node?: any) => {
      const text = await vscode.window.showInputBox({ prompt: 'Filter bookmarks by label (regex optional)', placeHolder: 'Search text or regex' });
      if (!text) return;
      const ui = getUIState();
      const searches = Array.isArray(ui.searches) ? [...ui.searches] : [];
      const { nanoid: gen } = await import('nanoid');
      const id = gen(8);
      searches.push({ id, text, regex: false, op: 'AND' });
      await setUIState({ ...ui, searches });
      provider.refresh();
    }),

    // Edit search filter
    vscode.commands.registerCommand('agenticBookmarks.editSearchFilter', async (node: any) => {
      const ui = getUIState();
      const id = node?.searchId as string | undefined;
      if (!id) return;
      const searches = Array.isArray(ui.searches) ? [...ui.searches] : [];
      const cur = searches.find(s => s.id === id);
      if (!cur) return;
      const text = await vscode.window.showInputBox({ prompt: 'Edit search', value: cur.text });
      if (text === undefined) return;
      cur.text = text;
      await setUIState({ ...ui, searches });
      provider.refresh();
    }),

    // Toggle AND/OR for search filter
    vscode.commands.registerCommand('agenticBookmarks.toggleSearchOp', async (node: any) => {
      const ui = getUIState();
      const id = node?.searchId as string | undefined;
      if (!id) return;
      const searches = Array.isArray(ui.searches) ? [...ui.searches] : [];
      const cur = searches.find(s => s.id === id);
      if (!cur) return;
      cur.op = cur.op === 'AND' ? 'OR' : 'AND';
      await setUIState({ ...ui, searches });
      provider.refresh();
    }),

    // Toggle regex mode
    vscode.commands.registerCommand('agenticBookmarks.toggleSearchRegex', async (node: any) => {
      const ui = getUIState();
      const id = node?.searchId as string | undefined;
      if (!id) return;
      const searches = Array.isArray(ui.searches) ? [...ui.searches] : [];
      const cur = searches.find(s => s.id === id);
      if (!cur) return;
      cur.regex = !cur.regex;
      await setUIState({ ...ui, searches });
      provider.refresh();
    }),

    // Remove search filter
    vscode.commands.registerCommand('agenticBookmarks.removeSearchFilter', async (node: any) => {
      const ui = getUIState();
      const id = node?.searchId as string | undefined;
      if (!id) return;
      const searches = Array.isArray(ui.searches) ? ui.searches.filter(s => s.id !== id) : [];
      await setUIState({ ...ui, searches });
      provider.refresh();
    }),
  ];
}
