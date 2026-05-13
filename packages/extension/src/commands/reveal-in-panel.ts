/**
 * Reveal-in-panel command extracted as its own module.
 *
 * Commands:
 *   agenticBookmarks.revealInPanel
 *
 * Bridges the editor gutter to the All Bookmarks side-panel: given a line
 * with a bookmark, focuses the view and selects the corresponding tree node.
 */

import * as vscode from 'vscode';
import {
  pathsForDataFile,
  readFileV2,
  readRegistry,
  type WorkspaceRegistryV1,
} from '@agentic-bookmarks/core';
import type { Logger } from '../logger';
import type { BookmarksProvider } from '../treeProvider';
import { getConfiguredDataRoot, resolveLineFromArg } from '../workspace-helpers';
import { findBookmarksOnLineMatching } from './find-bookmarks-on-line';
import { findBookmarkNodeInTree } from './reveal-in-panel-helpers';

export interface RevealInPanelDeps {
  workspaceRoot: string;
  log: Logger;
  provider: BookmarksProvider;
  treeView: vscode.TreeView<vscode.TreeItem>;
  getUIState: () => { hidden: string[]; focus: string | null; filterEnabled?: boolean };
  isFileHidden: (fileId: string, reg: WorkspaceRegistryV1) => boolean;
}

export function registerRevealInPanelCommand(deps: RevealInPanelDeps): vscode.Disposable[] {
  const { log, provider, treeView, getUIState, isFileHidden } = deps;

  return [
    vscode.commands.registerCommand('agenticBookmarks.revealInPanel', async (arg?: any) => {
      log.trace(() => `RevealInPanel invoked; arg=${JSON.stringify(arg ?? null)}`);

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        log.error('[RevealInPanel] No active editor');
        return;
      }

      const line = resolveLineFromArg(arg, editor);
      const fsPath = editor.document.uri.fsPath;

      const fileWorkspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (!fileWorkspaceFolder) {
        log.error(`[RevealInPanel] Cannot find workspace for: ${fsPath}`);
        vscode.window.showErrorMessage('Cannot reveal bookmark — file is outside the workspace.');
        return;
      }
      const fileWorkspaceRoot = fileWorkspaceFolder.uri.fsPath;

      const ui = getUIState();
      const visibility =
        ui.filterEnabled === true ? { hidden: ui.hidden, focus: ui.focus } : undefined;

      const reg = await readRegistry(fileWorkspaceRoot);
      const dataRoot = getConfiguredDataRoot(fileWorkspaceFolder);
      const visibleFiles = reg.files.filter(f => !isFileHidden((f as any).fileId, reg));

      let bookmarkId: string | null = null;
      for (const rf of visibleFiles) {
        const p = pathsForDataFile(rf.path, fileWorkspaceRoot, dataRoot);
        const file = await readFileV2(p);
        const matches = findBookmarksOnLineMatching(file, {
          fsPath,
          workspaceRoot: fileWorkspaceRoot,
          line,
          visibility,
        });
        if (matches.length > 0) {
          bookmarkId = matches[0].bookmarkId;
          break;
        }
      }

      if (!bookmarkId) {
        log.info(`RevealInPanel: no bookmark on line ${line + 1}`);
        vscode.window.showInformationMessage('No bookmark on this line.');
        return;
      }

      // Ensure the view container is rendered before reveal — without this,
      // reveal silently no-ops when the panel is collapsed.
      await vscode.commands.executeCommand('agenticBookmarks.view.focus');

      const node = await findBookmarkNodeInTree(provider, fsPath, bookmarkId);
      if (!node) {
        log.info(`RevealInPanel: bookmark ${bookmarkId} not in current tree (filter or hidden)`);
        vscode.window.showInformationMessage('Bookmark is hidden by the current filter.');
        return;
      }

      try {
        await treeView.reveal(node as unknown as vscode.TreeItem, {
          select: true,
          focus: true,
          expand: true,
        });
        log.info(`RevealInPanel: revealed bookmark ${bookmarkId}`);
      } catch (err: any) {
        log.error(`[RevealInPanel] reveal failed: ${err?.message || err}`);
      }
    }),
  ];
}
