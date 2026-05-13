/**
 * Bookmark navigation and re-anchoring commands extracted from extension.ts.
 *
 * Commands:
 *   agenticBookmarks.reanchor
 *   agenticBookmarks.confirmReanchor
 *   agenticBookmarks.cancelReanchor
 *   agenticBookmarks.autoRepairBookmark
 *
 * Also contains pick-mode state and executeReanchor helper.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { nanoid } from 'nanoid';
import {
  pathsForDataFile,
  editFileV2,
  readFileV2,
  readRegistry,
  getBookmarksDataRoot,
  createAnchor,
  resolveTargetAnchorType,
  resolveTagPlacement,
  workspaceRelativeToUri,
  toWorkspaceRelativePath,
  type BookmarksFileV2,
  type Paths,
  type WorkspaceRegistryV1,
} from '@agentic-bookmarks/core';
import { updateAnchorState } from '../anchorState';
import type { BookmarkNode } from '../treeProvider';
import type { Logger } from '../logger';
import type { BookmarksProvider } from '../treeProvider';
import type { FilesGroupsProvider } from '../filesGroupsProvider';
import type { RepairDeps } from '../anchor-repair-helpers';
import { runAutoRepairForBookmark, runFileMoveRepairForBookmark } from '../anchor-repair-helpers';
import {
  insertTagComment,
  removeTagComment,
  buildAgentRepairPrompt,
} from '../workspace-helpers';

// ---------------------------------------------------------------------------
// Pick-mode state (module-level singleton)
// ---------------------------------------------------------------------------

let pickModeState: {
  bookmarkNode: BookmarkNode;
  bookmark: BookmarksFileV2['bookmarks'][number];
  targetPaths: Paths;
  file: BookmarksFileV2;
  registry: WorkspaceRegistryV1;
  wsRoot: string;
  statusBarItem: vscode.StatusBarItem;
  disposables: vscode.Disposable[];
} | null = null;

export function cleanupPickMode(): void {
  if (pickModeState) {
    vscode.commands.executeCommand('setContext', 'agenticBookmarks.pickModeActive', false);
    pickModeState.statusBarItem.dispose();
    pickModeState.disposables.forEach(d => d.dispose());
    pickModeState = null;
  }
}

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface BookmarkNavigationDeps {
  workspaceRoot: string;
  log: Logger;
  provider: BookmarksProvider;
  filesGroups: FilesGroupsProvider;
  updateDecorations: () => Promise<void>;
  debouncedCacheSync: () => void;
  getLineCacheLength: () => number;
  repairDeps: RepairDeps;
}

// ---------------------------------------------------------------------------
// executeReanchor helper
// ---------------------------------------------------------------------------

async function executeReanchor(
  deps: BookmarkNavigationDeps,
  node: BookmarkNode,
  bookmark: BookmarksFileV2['bookmarks'][number],
  targetPaths: Paths,
  file: BookmarksFileV2,
  registry: WorkspaceRegistryV1,
  editor: vscode.TextEditor,
  targetLine: number,
  wsRoot: string
): Promise<void> {
  const { log, provider, updateDecorations, getLineCacheLength } = deps;
  const lines = editor.document.getText().split('\n');

  // If the old anchor was a tag anchor, remove the old tag comment first
  if (bookmark.anchor.kind === 'tag') {
    const oldTagId = bookmark.anchor.tagId;
    const oldLine = bookmark.anchor.lastUpdatedLine;
    const removed = await removeTagComment(editor.document, oldLine, oldTagId);
    if (removed) {
      log.info(`Reanchor: removed old tag comment @bookmark:${oldTagId} from line ${oldLine + 1}`);
    } else {
      log.info(`Reanchor: old tag comment @bookmark:${oldTagId} not found on line ${oldLine + 1} (may have been moved)`);
    }
  }

  // Resolve anchor type using waterfall
  const anchorType = resolveTargetAnchorType(file, registry);
  const isLocal = file.isLocal ?? false;
  const blankLinesUseSupport = vscode.workspace.getConfiguration('agenticBookmarks.anchors').get('blankLinesUseSupport', true);

  // Create new anchor
  let newAnchor;
  if (anchorType === 'tag') {
    const tagId = nanoid(6);
    newAnchor = createAnchor('tag', lines, targetLine, { lineCacheLength: getLineCacheLength() }, undefined, tagId);
    const languageId = editor.document.languageId;
    const tagPlacement = resolveTagPlacement(file, registry, languageId);
    await insertTagComment(editor, targetLine, tagId, tagPlacement);
  } else if (anchorType === 'smart') {
    newAnchor = createAnchor('smart', lines, targetLine, {
      isLocal,
      blankLinesUseSupport,
      lineCacheLength: getLineCacheLength()
    });
  } else {
    newAnchor = createAnchor('point', lines, targetLine, { lineCacheLength: getLineCacheLength() });
  }

  // Check if we're re-anchoring to a different file
  const editorPath = editor.document.uri.fsPath;
  const editorRelativePath = toWorkspaceRelativePath(editorPath, wsRoot);
  const currentTargetUri = bookmark.target.uri;

  // Determine if target needs updating
  let newTargetUri = currentTargetUri;
  if (editorRelativePath) {
    let currentPath: string;
    if (currentTargetUri.startsWith('file://')) {
      currentPath = vscode.Uri.parse(currentTargetUri).fsPath;
    } else {
      currentPath = path.join(wsRoot, currentTargetUri);
    }

    if (editorPath !== currentPath) {
      newTargetUri = editorRelativePath;
    }
  }

  // Update the bookmark
  await editFileV2(targetPaths, (f: BookmarksFileV2) => {
    const item = f.bookmarks.find(b => b.id === node.id);
    if (item) {
      item.anchor = newAnchor;
      if (newTargetUri !== currentTargetUri) {
        item.target = { uri: newTargetUri };
      }
    }
  });

  // Update anchor state to mark as valid
  const stateUri = newTargetUri !== currentTargetUri
    ? workspaceRelativeToUri(newTargetUri, wsRoot)
    : (bookmark.target.uri.startsWith('file://')
        ? bookmark.target.uri
        : workspaceRelativeToUri(bookmark.target.uri, wsRoot));
  updateAnchorState(stateUri, node.id, targetLine, 'valid');

  // Refresh UI
  provider.refresh();
  await updateDecorations();

  vscode.window.showInformationMessage(`Bookmark re-anchored to line ${targetLine + 1}`);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerBookmarkNavigationCommands(deps: BookmarkNavigationDeps): vscode.Disposable[] {
  const {
    workspaceRoot,
    log,
    provider,
    updateDecorations,
    repairDeps,
  } = deps;

  return [
    // Re-anchor bookmark
    vscode.commands.registerCommand('agenticBookmarks.reanchor', async (node: BookmarkNode) => {
      if (!node) return;

      const nodeWsRoot = node.workspaceRoot || workspaceRoot;
      const reg = await readRegistry(nodeWsRoot);
      const dataRoot = getBookmarksDataRoot(reg);
      const targetPaths = pathsForDataFile(node.dataFilePath, nodeWsRoot, dataRoot);
      const file = await readFileV2(targetPaths);
      const bookmark = file.bookmarks.find(b => b.id === node.id);

      if (!bookmark) {
        vscode.window.showErrorMessage('Bookmark no longer exists');
        return;
      }

      // Build quick pick options
      const items: vscode.QuickPickItem[] = [];
      const editor = vscode.window.activeTextEditor;

      if (editor) {
        const fileName = path.basename(editor.document.uri.fsPath);
        const line = editor.selection.active.line + 1;

        // Check if this is the same file as the bookmark
        let bookmarkFileUri = bookmark.target.uri;
        if (!bookmarkFileUri.startsWith('file://')) {
          bookmarkFileUri = workspaceRelativeToUri(bookmarkFileUri, nodeWsRoot);
        }
        const editorUri = editor.document.uri.toString();
        const isSameFile = editorUri === bookmarkFileUri;

        const label = isSameFile
          ? `$(location) Current line: ${fileName}:${line}`
          : `$(warning) Current line: ${fileName}:${line} (different file)`;

        items.push({
          label,
          description: editor.document.lineAt(editor.selection.active.line).text.trim().substring(0, 50),
          detail: isSameFile
            ? 'Re-anchor to the current cursor position'
            : 'Warning: This will change the bookmark target file'
        });
      }

      items.push({
        label: '$(search) Pick line now...',
        description: 'Navigate to the file and select a line',
        detail: 'Opens the bookmarked file for interactive line selection'
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select where to re-anchor this bookmark'
      });

      if (!selected) return;

      let targetLine: number;
      let targetEditor: vscode.TextEditor;

      if (selected.label.startsWith('$(location)') || selected.label.startsWith('$(warning)')) {
        if (!editor) {
          vscode.window.showErrorMessage('No active editor');
          return;
        }
        targetLine = editor.selection.active.line;
        targetEditor = editor;
      } else {
        // Clean up any existing pick mode first
        cleanupPickMode();

        // Pick mode - open file and wait for user to position cursor
        let targetUri = bookmark.target.uri;
        if (!targetUri.startsWith('file://')) {
          targetUri = workspaceRelativeToUri(targetUri, nodeWsRoot);
        }
        const fileUri = vscode.Uri.parse(targetUri);

        // Get last known line from anchor
        let lastKnownLine = 0;
        if (bookmark.anchor.kind === 'point') {
          lastKnownLine = bookmark.anchor.line;
        } else if (bookmark.anchor.kind === 'range') {
          lastKnownLine = bookmark.anchor.start.line;
        } else if (bookmark.anchor.kind === 'smart' || bookmark.anchor.kind === 'tag') {
          lastKnownLine = bookmark.anchor.lastUpdatedLine;
        }

        // Open the file
        let pickedEditor: vscode.TextEditor;
        try {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          pickedEditor = await vscode.window.showTextDocument(doc);
        } catch (err) {
          vscode.window.showErrorMessage('Cannot re-anchor: file not found');
          return;
        }

        // Position cursor at last known line
        const maxLine = pickedEditor.document.lineCount - 1;
        const startLine = Math.max(0, Math.min(lastKnownLine, maxLine));
        const position = new vscode.Position(startLine, 0);
        pickedEditor.selection = new vscode.Selection(position, position);
        pickedEditor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);

        // Create status bar item
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.text = '$(bookmark) Move cursor to new line, then click here or press Enter';
        statusBarItem.command = 'agenticBookmarks.confirmReanchor';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        statusBarItem.show();

        // Set up disposables for cleanup
        const disposables: vscode.Disposable[] = [];

        disposables.push(vscode.window.onDidChangeActiveTextEditor((e) => {
          if (e && e.document.uri.toString() !== fileUri.toString()) {
            cleanupPickMode();
          }
        }));

        disposables.push(vscode.workspace.onDidCloseTextDocument((doc) => {
          if (doc.uri.toString() === fileUri.toString()) {
            cleanupPickMode();
          }
        }));

        // Store state
        pickModeState = {
          bookmarkNode: node,
          bookmark,
          targetPaths,
          file,
          registry: reg,
          wsRoot: nodeWsRoot,
          statusBarItem,
          disposables
        };

        vscode.commands.executeCommand('setContext', 'agenticBookmarks.pickModeActive', true);

        return; // Exit command, wait for confirm/cancel
      }

      await executeReanchor(deps, node, bookmark, targetPaths, file, reg, targetEditor, targetLine, nodeWsRoot);
    }),

    // Auto-repair broken bookmark
    vscode.commands.registerCommand('agenticBookmarks.autoRepairBookmark', async (node: BookmarkNode) => {
      if (!node) {
        vscode.window.showWarningMessage('Select a broken bookmark first.');
        return;
      }

      const result = await runAutoRepairForBookmark(node.id, repairDeps, { ignoreAutoRepairSetting: true });
      if (result.status === 'repaired') {
        const oldLine = result.oldLine !== undefined ? `${result.oldLine + 1}` : '?';
        const newLine = result.newLine !== undefined ? `${result.newLine + 1}` : '?';
        vscode.window.showInformationMessage(
          `Auto-repaired bookmark ${node.id}: line ${oldLine} -> ${newLine}`
        );
        if (result.debug) {
          log.trace(() => `[autoRepairDebug] Manual repair success for ${node.id}: ${JSON.stringify(result.debug)}`);
        }
        return;
      }

      const reason = result.reason || 'unknown';
      if (result.debug) {
        log.debug(() => `[autoRepairDebug] Manual repair failure for ${node.id}: ${JSON.stringify(result.debug)}`);
      }

      // If regular repair failed because file is missing, try file-move repair
      if (reason === 'target file not readable') {
        const fileMoveResult = await runFileMoveRepairForBookmark(node.id, workspaceRoot, repairDeps);
        if (fileMoveResult.status === 'repaired' && fileMoveResult.newFilePath) {
          vscode.window.showInformationMessage(
            `Auto-repair succeeded — file moved to ${fileMoveResult.newFilePath}`
          );
          try {
            const newUri = workspaceRelativeToUri(fileMoveResult.newFilePath, workspaceRoot);
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(newUri));
            const editor = await vscode.window.showTextDocument(doc);
            const line = fileMoveResult.newLine ?? 0;
            const range = new vscode.Range(line, 0, line, 0);
            editor.selection = new vscode.Selection(range.start, range.end);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
          } catch { /* non-critical */ }
          return;
        }
      }

      vscode.window.showWarningMessage(
        `Auto-repair failed for bookmark ${node.id}: ${reason}. You can ask your agent: "${buildAgentRepairPrompt(node.id)}"`
      );
    }),

    // Confirm re-anchor (from pick mode)
    vscode.commands.registerCommand('agenticBookmarks.confirmReanchor', async () => {
      if (!pickModeState) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        cleanupPickMode();
        return;
      }

      const targetLine = editor.selection.active.line;
      const { bookmarkNode, bookmark, targetPaths, file, registry, wsRoot } = pickModeState;

      cleanupPickMode();

      try {
        await executeReanchor(deps, bookmarkNode, bookmark, targetPaths, file, registry, editor, targetLine, wsRoot);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to re-anchor bookmark: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    // Cancel re-anchor
    vscode.commands.registerCommand('agenticBookmarks.cancelReanchor', async () => {
      if (pickModeState) {
        cleanupPickMode();
        vscode.window.showInformationMessage('Re-anchor cancelled');
      }
    }),

    // Status info (right-click menu explanation for warning/broken states)
    vscode.commands.registerCommand('agenticBookmarks.statusInfo', (node: BookmarkNode) => {
      if (!node) return;
      if (node.status === 'warning') {
        vscode.window.showInformationMessage(
          `Partial context match (score: ${node.score?.toFixed(2) ?? '?'}). Use re-link to refresh the anchor.`
        );
      } else if (node.status === 'broken') {
        vscode.window.showWarningMessage(
          node.errorDetails || 'Bookmark not found in file'
        );
      }
    }),
  ];
}
