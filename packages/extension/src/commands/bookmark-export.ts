// ABOUTME: VS Code glue for `agenticBookmarks.export` — loads visible bookmarks,
// ABOUTME: renders to Markdown via the configurable pattern, and writes to a user-chosen path.

import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import * as vscode from 'vscode';
import {
  type WorkspaceRegistryV1,
} from '@agentic-bookmarks/core';
import type { Logger } from '../logger';
import {
  buildBookmarkPickItems,
  type SearchFilter,
} from './bookmark-quickpick-items';
import { loadAllFolders, makeResolveLine } from './bookmark-loaders';
import { composeFileHiddenPredicate } from './bookmark-loaders-helpers';
import {
  renderBookmarksMarkdown,
  DEFAULT_EXPORT_PATTERN,
} from './bookmark-export-helpers';

export interface BookmarkExportDeps {
  workspaceRoot: string;
  log: Logger;
  getUIState: () => {
    hidden: string[];
    focus: string | null;
    filterEnabled?: boolean;
    hiddenFiles?: string[];
    searches?: SearchFilter[];
  };
  isFileHidden: (fileId: string, reg: WorkspaceRegistryV1) => boolean;
}

export function registerBookmarkExportCommand(
  deps: BookmarkExportDeps,
): vscode.Disposable[] {
  const { workspaceRoot, log, getUIState, isFileHidden } = deps;

  return [
    vscode.commands.registerCommand('agenticBookmarks.export', async () => {
      if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showWarningMessage('No workspace folder open');
        return;
      }

      const { folders, filesData } = await loadAllFolders(log, workspaceRoot);

      const ui = getUIState();
      const visibility = {
        hidden: ui.hidden,
        focus: ui.focus,
        filterEnabled: ui.filterEnabled === true,
        searches: ui.searches,
      };

      const composedIsFileHidden = composeFileHiddenPredicate(folders, filesData, visibility, isFileHidden);

      const items = buildBookmarkPickItems({
        scope: 'all',
        visibility,
        filesData,
        isFileHidden: composedIsFileHidden,
        resolveLine: makeResolveLine(),
      });

      if (items.length === 0) {
        vscode.window.showInformationMessage('No bookmarks to export');
        return;
      }

      // Read the configured pattern. Treat an empty string as "use the default"
      // so the rendered document isn't a sequence of empty lines.
      const configured = vscode.workspace
        .getConfiguration('agenticBookmarks.export')
        .get<string>('pattern', DEFAULT_EXPORT_PATTERN);
      const pattern = configured && configured.length > 0 ? configured : DEFAULT_EXPORT_PATTERN;

      const body = renderBookmarksMarkdown(items, pattern);
      const content = `# Bookmarks\n\n${body}\n`;

      const defaultUri = vscode.Uri.file(
        path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'bookmarks.md'),
      );
      const target = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { Markdown: ['md'] },
        saveLabel: 'Export Bookmarks',
        title: 'Export Bookmarks to Markdown',
      });
      if (!target) return;

      try {
        await fsp.mkdir(path.dirname(target.fsPath), { recursive: true });
        await fsp.writeFile(target.fsPath, content, 'utf8');
        vscode.window.showInformationMessage(
          `Exported ${items.length} bookmark${items.length === 1 ? '' : 's'} to ${vscode.workspace.asRelativePath(target)}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`bookmark-export: failed to write ${target.fsPath}: ${msg}`);
        vscode.window.showErrorMessage(`Failed to export bookmarks: ${msg}`);
      }
    }),
  ];
}
