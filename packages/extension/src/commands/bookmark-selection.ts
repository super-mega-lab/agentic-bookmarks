// ABOUTME: Selection commands — selectLines / expandSelectionToNext /
// ABOUTME: expandSelectionToPrevious / shrinkSelection. Wires pure helpers.

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
  type UIStateForJump,
  type VisibleBookmark,
} from './bookmark-jump-helpers';
import {
  buildLineSelections,
  computeExpandedSelection,
  computeShrunkSelection,
} from './bookmark-selection-helpers';

export interface BookmarkSelectionDeps {
  workspaceRoot: string;
  log: Logger;
  getUIState: () => UIStateForJump;
  isFileHidden: (fileId: string, reg: WorkspaceRegistryV1) => boolean;
}

export function registerBookmarkSelectionCommands(
  deps: BookmarkSelectionDeps,
): vscode.Disposable[] {
  const { log, getUIState, isFileHidden } = deps;

  async function runCollect(label: string): Promise<VisibleBookmark[] | null> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    try {
      return await collectVisibleBookmarks({
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
      log.error(`[${label}] Failed to collect bookmarks: ${err}`);
      vscode.window.showErrorMessage('Failed to read bookmarks');
      return null;
    }
  }

  async function runSelectLines(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active editor');
      return;
    }
    const cfg = vscode.workspace.getConfiguration('agenticBookmarks');
    const revealLocation = cfg.get<'top' | 'center'>('revealLocation', 'center');

    const visible = await runCollect('SelectLines');
    if (!visible) return;

    const fsPath = editor.document.uri.fsPath;
    const ranges = buildLineSelections(visible, fsPath);
    if (ranges.length === 0) {
      vscode.window.showInformationMessage('No bookmarks in this file');
      return;
    }

    const selections = ranges.map(r => {
      const endChar =
        r.endCharacter === -1
          ? editor.document.lineAt(r.endLine).range.end.character
          : r.endCharacter;
      return new vscode.Selection(
        new vscode.Position(r.startLine, r.startCharacter),
        new vscode.Position(r.endLine, endChar),
      );
    });

    editor.selections = selections;
    editor.revealRange(
      selections[0],
      mapRevealType(revealLocation) as vscode.TextEditorRevealType,
    );
    log.info(`SelectLines: ${selections.length} line(s) in ${fsPath}`);
  }

  async function runExpand(direction: 'next' | 'prev'): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active editor');
      return;
    }
    const cfg = vscode.workspace.getConfiguration('agenticBookmarks');
    const revealLocation = cfg.get<'top' | 'center'>('revealLocation', 'center');

    const visible = await runCollect(direction === 'next' ? 'ExpandNext' : 'ExpandPrev');
    if (!visible) return;

    const fsPath = editor.document.uri.fsPath;
    const result = computeExpandedSelection(
      visible,
      fsPath,
      {
        anchorLine: editor.selection.anchor.line,
        activeLine: editor.selection.active.line,
      },
      direction,
    );

    if (!result) {
      vscode.window.showInformationMessage(
        direction === 'next' ? 'No further bookmark' : 'No previous bookmark',
      );
      return;
    }

    const newSelection = new vscode.Selection(
      editor.selection.anchor,
      new vscode.Position(result.newActiveLine, 0),
    );
    editor.selection = newSelection;
    editor.revealRange(
      newSelection,
      mapRevealType(revealLocation) as vscode.TextEditorRevealType,
    );
    log.info(
      `Expand${direction === 'next' ? 'Next' : 'Previous'}: -> ${fsPath}:${result.newActiveLine + 1}`,
    );
  }

  async function runShrink(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active editor');
      return;
    }
    if (editor.selection.isEmpty) return;

    const cfg = vscode.workspace.getConfiguration('agenticBookmarks');
    const revealLocation = cfg.get<'top' | 'center'>('revealLocation', 'center');

    const visible = await runCollect('Shrink');
    if (!visible) return;

    const fsPath = editor.document.uri.fsPath;
    const result = computeShrunkSelection(visible, fsPath, {
      anchorLine: editor.selection.anchor.line,
      activeLine: editor.selection.active.line,
    });
    // result is non-null because we already checked isEmpty above.
    if (!result) return;

    const newSelection = new vscode.Selection(
      editor.selection.anchor,
      new vscode.Position(result.newActiveLine, 0),
    );
    editor.selection = newSelection;
    editor.revealRange(
      newSelection,
      mapRevealType(revealLocation) as vscode.TextEditorRevealType,
    );
    log.info(`Shrink: -> ${fsPath}:${result.newActiveLine + 1}`);
  }

  return [
    vscode.commands.registerCommand('agenticBookmarks.selectLines', runSelectLines),
    vscode.commands.registerCommand('agenticBookmarks.expandSelectionToNext', () => runExpand('next')),
    vscode.commands.registerCommand('agenticBookmarks.expandSelectionToPrevious', () => runExpand('prev')),
    vscode.commands.registerCommand('agenticBookmarks.shrinkSelection', runShrink),
  ];
}
