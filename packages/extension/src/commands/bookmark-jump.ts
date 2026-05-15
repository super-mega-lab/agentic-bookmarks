// ABOUTME: Jump-to-next / jump-to-previous bookmark commands. Wires the pure
// ABOUTME: helpers in bookmark-jump-helpers.ts to the active editor + settings.

import * as vscode from 'vscode';
import {
  readRegistry,
  readFileV2,
  pathsForDataFile,
  getBookmarksDataRoot,
  workspaceRelativeToUri,
  type WorkspaceRegistryV1,
} from '@agentic-bookmarks/core';
import { getResolvedLine } from '../anchorState';
import type { Logger } from '../logger';
import {
  collectVisibleBookmarks,
  mapRevealType,
  pickJumpTarget,
  type CursorPosition,
  type JumpDirection,
  type RevealLocation,
  type UIStateForJump,
  type VisibleBookmark,
} from './bookmark-jump-helpers';

export interface BookmarkJumpDeps {
  workspaceRoot: string;
  log: Logger;
  getUIState: () => UIStateForJump;
  isFileHidden: (fileId: string, reg: WorkspaceRegistryV1) => boolean;
}

export function registerBookmarkJumpCommands(deps: BookmarkJumpDeps): vscode.Disposable[] {
  const { log, getUIState, isFileHidden } = deps;

  async function runJump(direction: JumpDirection): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active editor');
      return;
    }

    const cfg = vscode.workspace.getConfiguration('agenticBookmarks');
    const navigateThroughAllFiles = cfg.get<boolean>('navigateThroughAllFiles', false);
    const wrapNavigation = cfg.get<boolean>('wrapNavigation', true);
    const revealLocation = cfg.get<RevealLocation>('revealLocation', 'center');

    const cursor: CursorPosition = {
      fileFsPath: editor.document.uri.fsPath,
      line: editor.selection.active.line,
    };

    const folders = vscode.workspace.workspaceFolders ?? [];
    let visible: VisibleBookmark[];
    try {
      visible = await collectVisibleBookmarks({
        workspaceFolders: folders.map(f => ({ uri: { fsPath: f.uri.fsPath } })),
        readRegistry,
        readFileV2,
        pathsForDataFile,
        getBookmarksDataRoot,
        workspaceRelativeToUri,
        getResolvedLine,
        isFileHidden,
        getUIState,
        log,
      });
    } catch (err) {
      log.error(`[Jump${direction === 'next' ? 'Next' : 'Previous'}] Failed to collect bookmarks: ${err}`);
      vscode.window.showErrorMessage('Failed to read bookmarks');
      return;
    }

    if (visible.length === 0) {
      vscode.window.showInformationMessage('No visible bookmarks');
      return;
    }

    const target = pickJumpTarget(visible, cursor, direction, {
      navigateThroughAllFiles,
      wrapNavigation,
    });

    if (!target) {
      vscode.window.showInformationMessage(
        direction === 'next' ? 'No further bookmark' : 'No previous bookmark',
      );
      return;
    }

    let activeEditor = editor;
    if (target.fileFsPath !== cursor.fileFsPath) {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(target.fileAbsoluteUri));
        activeEditor = await vscode.window.showTextDocument(doc);
      } catch (err) {
        log.error(`[Jump${direction === 'next' ? 'Next' : 'Previous'}] Failed to open ${target.fileAbsoluteUri}: ${err}`);
        vscode.window.showWarningMessage('Bookmark file not accessible');
        return;
      }
    }

    const range = new vscode.Range(target.line, 0, target.line, 0);
    activeEditor.selection = new vscode.Selection(range.start, range.end);
    activeEditor.revealRange(range, mapRevealType(revealLocation) as vscode.TextEditorRevealType);
    log.info(
      `Jump${direction === 'next' ? 'Next' : 'Previous'}: id=${target.bookmarkId} -> ${target.fileFsPath}:${target.line + 1}`,
    );
  }

  return [
    vscode.commands.registerCommand('agenticBookmarks.jumpNext', () => runJump('next')),
    vscode.commands.registerCommand('agenticBookmarks.jumpPrevious', () => runJump('prev')),
  ];
}
