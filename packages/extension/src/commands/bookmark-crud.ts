/**
 * Bookmark CRUD commands extracted from extension.ts.
 *
 * Commands:
 *   agenticBookmarks.add
 *   agenticBookmarks.addAtLine
 *   agenticBookmarks.addLabeledAtLine
 *   agenticBookmarks.removeAtLine
 *   agenticBookmarks.toggle
 *   agenticBookmarks.toggleLabeled
 *   agenticBookmarks.edit
 *   agenticBookmarks.delete
 *   agenticBookmarks.open
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { nanoid } from 'nanoid';
import {
  pathsForDataFile,
  editFileV2,
  readFileV2,
  readRegistry,
  getOrCreateUnsortedGroup,
  getBookmarksDataRoot,
  createAnchor,
  resolveIsLocal,
  resolveTargetAnchorType,
  resolveTagPlacement,
  workspaceRelativeToUri,
  toWorkspaceRelativePath,
  readFileV2 as readFileV2Paths,
  type BookmarksFileV2,
  type WorkspaceRegistryV1,
} from '@agentic-bookmarks/core';
import { getResolvedLine, markBookmarkBroken } from '../anchorState';
import type { BookmarkNode } from '../treeProvider';
import type { Logger } from '../logger';
import type { BookmarksProvider } from '../treeProvider';
import type { FilesGroupsProvider } from '../filesGroupsProvider';
import type { BookmarkCodeLensProvider } from '../bookmarkCodeLensProvider';
import type { RepairDeps } from '../anchor-repair-helpers';
import { runFileMoveRepairForBookmark } from '../anchor-repair-helpers';
import {
  resolveLineFromArg,
  insertTagComment,
  removeTagComment,
  buildAgentRepairPrompt,
  getConfiguredDataRoot,
} from '../workspace-helpers';
import { findBookmarksOnLineMatching, effectiveAnchorLine, type LineMatch } from './find-bookmarks-on-line';
import {
  partitionBookmarksForClear,
  bookmarkMatchesActiveFile,
  type TagAnchorRemoval,
} from './clear-bookmarks-helpers';

export interface BookmarkCrudDeps {
  workspaceRoot: string;
  log: Logger;
  provider: BookmarksProvider;
  filesGroups: FilesGroupsProvider;
  codeLensProvider: BookmarkCodeLensProvider | null;
  updateDecorations: () => Promise<void>;
  debouncedCacheSync: () => void;
  getLineCacheLength: () => number;
  getLineCacheFor: (editor: vscode.TextEditor, line: number) => string | undefined;
  getDefaultTargetForWorkspace: (
    targetWorkspaceRoot: string,
    targetWorkspaceFolder: vscode.WorkspaceFolder
  ) => Promise<{ paths: { dir: string; data: string; bak: string; lock: string; pulse: string }; groupId: string }>;
  repairDeps: RepairDeps;
  getUIState?: () => { hidden: string[]; focus: string | null; filterEnabled?: boolean };
  /**
   * Returns true when a file should be excluded from visibility — either
   * disabled in the registry (`enabled === false`) or hidden by the user via
   * `ui.hiddenFiles`. Required by `agenticBookmarks.toggle` to avoid silently
   * destroying bookmarks in files the user has hidden.
   */
  isFileHidden: (fileId: string, reg: WorkspaceRegistryV1) => boolean;
}

export function registerBookmarkCrudCommands(deps: BookmarkCrudDeps): vscode.Disposable[] {
  const {
    workspaceRoot,
    log,
    provider,
    filesGroups,
    updateDecorations,
    debouncedCacheSync,
    getLineCacheLength,
    getDefaultTargetForWorkspace,
    repairDeps,
    getUIState,
    isFileHidden,
  } = deps;

  /**
   * Toggle a bookmark on the current line.
   *
   * Visibility-aware: when filtering is on (and `getUIState` is wired), only
   * bookmarks in visible groups participate in the "is one already here?"
   * check. If any visible bookmarks are found on the line, they are removed.
   * Otherwise a new bookmark is added to the default group, with an optional
   * label prompt.
   */
  async function runToggle(arg: any, opts: { promptForLabel: boolean }): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor');
      return;
    }

    const line = resolveLineFromArg(arg, editor);
    const fsPath = editor.document.uri.fsPath;

    const fileWorkspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!fileWorkspaceFolder) {
      log.error(`[Toggle] Cannot find workspace for: ${fsPath}`);
      vscode.window.showErrorMessage('Cannot bookmark files outside the workspace.');
      return;
    }
    const fileWorkspaceRoot = fileWorkspaceFolder.uri.fsPath;

    const ui = getUIState ? getUIState() : undefined;
    const visibility =
      ui && ui.filterEnabled === true ? { hidden: ui.hidden, focus: ui.focus } : undefined;

    // Pass 1: scan all visible files to decide add-or-remove. Skip files
    // disabled in the registry OR hidden by the user via ui.hiddenFiles —
    // toggling must never silently destroy bookmarks in invisible files.
    const reg = await readRegistry(fileWorkspaceRoot);
    const dataRoot = getConfiguredDataRoot(fileWorkspaceFolder);
    const visibleFiles = reg.files.filter(f => !isFileHidden((f as any).fileId, reg));

    const matchesPerFile: Array<{ rfPath: string; matches: LineMatch[] }> = [];
    for (const rf of visibleFiles) {
      const p = pathsForDataFile(rf.path, fileWorkspaceRoot, dataRoot);
      const file = await readFileV2Paths(p);
      const matches = findBookmarksOnLineMatching(file, {
        fsPath,
        workspaceRoot: fileWorkspaceRoot,
        line,
        visibility,
        resolveLine: (id: string) => getResolvedLine(editor.document.uri.toString(), id),
      });
      if (matches.length > 0) matchesPerFile.push({ rfPath: rf.path, matches });
    }

    if (matchesPerFile.length > 0) {
      // REMOVE branch
      const tagAnchorsToRemove: Array<{ tagId: string; line: number }> = [];
      let totalRemoved = 0;
      for (const { rfPath, matches } of matchesPerFile) {
        const ids = new Set(matches.map(m => m.bookmarkId));
        for (const m of matches) {
          if (m.anchorKind === 'tag' && m.tagId !== undefined && m.tagLine !== undefined) {
            tagAnchorsToRemove.push({ tagId: m.tagId, line: m.tagLine });
          }
        }
        const p = pathsForDataFile(rfPath, fileWorkspaceRoot, dataRoot);
        await editFileV2(p as any, (file: BookmarksFileV2) => {
          const before = file.bookmarks.length;
          file.bookmarks = file.bookmarks.filter(b => !ids.has((b as any).id));
          const removed = before - file.bookmarks.length;
          totalRemoved += removed;
          if (removed > 0) {
            log.info(
              `Toggle: ${removed} removed in ${vscode.workspace.asRelativePath(rfPath)} (${before} -> ${file.bookmarks.length})`
            );
          }
        });
      }
      log.info(`Toggle: total removed across files = ${totalRemoved}`);

      for (const { tagId, line: tagLine } of tagAnchorsToRemove) {
        const removed = await removeTagComment(editor.document, tagLine, tagId);
        if (removed) {
          log.info(`Toggle: removed tag comment @bookmark:${tagId} from line ${tagLine + 1}`);
        } else {
          log.info(
            `Toggle: tag comment @bookmark:${tagId} not found on line ${tagLine + 1} (may have been moved)`
          );
        }
      }
    } else {
      // ADD branch
      let label = '';
      if (opts.promptForLabel) {
        const input = await vscode.window.showInputBox({
          prompt: 'Enter bookmark description',
          placeHolder: `Bookmark at line ${line + 1}`,
        });
        if (input === undefined) return; // user cancelled — no-op
        label = input || `Ln ${line + 1}`;
      }

      const relativePath = toWorkspaceRelativePath(fsPath, fileWorkspaceRoot);
      if (!relativePath) {
        log.error('[Toggle] Failed to convert to relative path');
        vscode.window.showErrorMessage('Cannot bookmark files outside the workspace.');
        return;
      }

      const target = await getDefaultTargetForWorkspace(fileWorkspaceRoot, fileWorkspaceFolder);
      const targetFile = await readFileV2Paths(target.paths);
      const defaultAnchorType = resolveTargetAnchorType(targetFile, reg);
      const blankLinesUseSupport = vscode.workspace
        .getConfiguration('agenticBookmarks.anchors')
        .get('blankLinesUseSupport', true);
      const lines = editor.document.getText().split('\n');

      const bookmarkId = nanoid(8);
      const isLocal = resolveIsLocal(targetFile, target.paths.data, fileWorkspaceRoot);

      let anchor;
      if (defaultAnchorType === 'tag') {
        anchor = createAnchor(
          'tag',
          lines,
          line,
          { lineCacheLength: getLineCacheLength() },
          undefined,
          bookmarkId
        );
      } else if (defaultAnchorType === 'smart') {
        anchor = createAnchor('smart', lines, line, {
          isLocal,
          blankLinesUseSupport,
          lineCacheLength: getLineCacheLength(),
        });
      } else {
        anchor = createAnchor('point', lines, line, { lineCacheLength: getLineCacheLength() });
      }

      await editFileV2(target.paths, (file: BookmarksFileV2) => {
        const groupExists = file.groups.some(g => (g as any).id === target.groupId);
        const groupId = groupExists ? target.groupId : getOrCreateUnsortedGroup(file);
        file.bookmarks.unshift({
          id: bookmarkId,
          fileId: file.fileId,
          groupId,
          target: { uri: relativePath },
          anchor,
          label,
          createdAt: Date.now(),
          createdBy: 'extension',
          source: 'extension',
          tags: [],
        } as any);
      });

      if (defaultAnchorType === 'tag') {
        const languageId = editor.document.languageId;
        const tagPlacement = resolveTagPlacement(targetFile, reg, languageId);
        const tagInserted = await insertTagComment(editor, line, bookmarkId, tagPlacement);
        if (!tagInserted) {
          log.error(`[Toggle] Warning: Failed to insert tag comment for bookmark ${bookmarkId}`);
        }
      }

      log.info(`Toggle: added bookmark at line ${line + 1} with ${defaultAnchorType} anchor`);
    }

    provider.refresh();
    await updateDecorations();
  }

  /**
   * Bulk-clear bookmarks matching `predicate` across every enabled registered
   * file. Drives both `agenticBookmarks.clearFile` (predicate scoped to active
   * editor's file) and `agenticBookmarks.clearAll` (predicate `() => true`).
   *
   * Three passes:
   *   1. Read each file, partition with `partitionBookmarksForClear`, collect
   *      total count + tag-anchor removals grouped by source URI, and record
   *      per-file ids to remove (so the second pass doesn't re-run the
   *      predicate).
   *   2. After confirm, run `editFileV2` per file with non-empty matches,
   *      filtering out the recorded ids. Per-file try/catch — a failure on one
   *      file is logged and the remaining files still get cleared.
   *   3. For each tag anchor: open the source document (re-using the active
   *      editor's document when it matches), strip the `@bookmark:<tagId>`
   *      comment via `removeTagComment`, and save if we opened a non-active
   *      document. Per-source-file try/catch.
   */
  async function runClear(opts: {
    /** Human label used in confirm/info messages, e.g. "src/foo.ts" or "all registered files" */
    title: string;
    /** Predicate applied to each bookmark — return true to clear it */
    predicate: (b: BookmarksFileV2['bookmarks'][number]) => boolean;
    /**
     * The active editor (used to remove tag comments from the active document
     * efficiently). When null (clearAll without an active editor), tag-comment
     * cleanup is performed by opening each source file via openTextDocument.
     */
    activeEditor: vscode.TextEditor | null;
    /**
     * The workspace folders to scan — each is read with its OWN registry +
     * dataRoot + root-relative URI resolution. `clearFile` passes the active
     * file's owning folder; `clearAll` passes every workspace folder.
     */
    folders: vscode.WorkspaceFolder[];
  }): Promise<void> {
    // First pass: count matches, record per-(folder,file) ids to remove (so the
    // same relative path in two folders does not collide), group tag anchors by
    // their OWNING-folder absolute source URI.
    const deletePlan: Array<{ root: string; dataRoot: string; rfPath: string; ids: Set<string> }> = [];
    const tagAnchorsBySource = new Map<string, TagAnchorRemoval[]>();
    let totalCount = 0;

    for (const folder of opts.folders) {
      const root = folder.uri.fsPath;
      const dataRoot = getConfiguredDataRoot(folder);
      let reg;
      try {
        reg = await readRegistry(root);
      } catch (e) {
        log.error(`Clear: readRegistry failed for ${root}: ${e}`);
        continue;
      }
      const enabled = reg.files.filter(f => f.enabled !== false);

      for (const rf of enabled) {
        const p = pathsForDataFile(rf.path, root, dataRoot);
        let file: BookmarksFileV2;
        try {
          file = await readFileV2(p);
        } catch (e) {
          log.error(`Clear: readFileV2 failed for ${rf.path}: ${e}`);
          continue;
        }
        const { cleared, tagAnchorsToRemove } = partitionBookmarksForClear(file, opts.predicate);
        if (cleared.length === 0) continue;
        totalCount += cleared.length;
        deletePlan.push({ root, dataRoot, rfPath: rf.path, ids: new Set(cleared.map(b => (b as any).id)) });
        for (const entry of tagAnchorsToRemove) {
          const base = entry.sourceUri.split('#')[0];
          const absoluteUri = base.startsWith('file://')
            ? base
            : workspaceRelativeToUri(base, root);
          const list = tagAnchorsBySource.get(absoluteUri);
          if (list) list.push(entry);
          else tagAnchorsBySource.set(absoluteUri, [entry]);
        }
      }
    }

    if (totalCount === 0) {
      vscode.window.showInformationMessage(`No bookmarks to clear from ${opts.title}`);
      return;
    }

    const confirmEnabled = vscode.workspace
      .getConfiguration('agenticBookmarks')
      .get<boolean>('confirmClear', true);
    if (confirmEnabled) {
      const action = 'Clear';
      const confirm = await vscode.window.showWarningMessage(
        `Clear ${totalCount} bookmark${totalCount === 1 ? '' : 's'} from ${opts.title}?`,
        { modal: true },
        action
      );
      if (confirm !== action) return;
    }

    // Second pass: edit each affected data file.
    let totalRemoved = 0;
    for (const { root, dataRoot, rfPath, ids } of deletePlan) {
      const p = pathsForDataFile(rfPath, root, dataRoot);
      try {
        await editFileV2(p as any, (file: BookmarksFileV2) => {
          const before = file.bookmarks.length;
          file.bookmarks = file.bookmarks.filter(b => !ids.has((b as any).id));
          totalRemoved += before - file.bookmarks.length;
        });
      } catch (e) {
        log.error(`Clear: editFileV2 failed for ${rfPath}: ${e}`);
      }
    }

    // Third pass: strip @bookmark:<tagId> comments from each absolute source URI.
    for (const [absoluteUri, entries] of tagAnchorsBySource) {
      try {
        const activeUriString = opts.activeEditor?.document.uri.toString();
        const isActive =
          !!opts.activeEditor &&
          (opts.activeEditor.document.uri.toString() === absoluteUri ||
            activeUriString === vscode.Uri.parse(absoluteUri).toString());
        const doc = isActive
          ? opts.activeEditor!.document
          : await vscode.workspace.openTextDocument(vscode.Uri.parse(absoluteUri));

        for (const entry of entries) {
          const removed = await removeTagComment(doc, entry.line, entry.tagId);
          if (removed) {
            log.info(
              `Clear: removed tag comment @bookmark:${entry.tagId} from line ${entry.line + 1}`
            );
          } else {
            log.info(
              `Clear: tag comment @bookmark:${entry.tagId} not found on line ${entry.line + 1} (may have been moved)`
            );
          }
        }

        if (!isActive) {
          await doc.save();
        }
      } catch (e) {
        log.error(`Clear: tag-comment cleanup failed for ${absoluteUri}: ${e}`);
      }
    }

    provider.refresh();
    filesGroups.refresh();
    await updateDecorations();
    log.info(`Clear: removed ${totalRemoved} bookmarks from ${opts.title}`);
  }

  return [
    // Add bookmark (with label prompt)
    vscode.commands.registerCommand('agenticBookmarks.add', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const label = await vscode.window.showInputBox({
        prompt: 'Enter bookmark description',
        placeHolder: 'My bookmark'
      });

      if (!label) return;

      // Determine which workspace folder this file belongs to
      const absolutePath = editor.document.uri.fsPath;
      const fileWorkspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (!fileWorkspaceFolder) {
        log.error(`[Add] Cannot find workspace for: ${absolutePath}`);
        vscode.window.showErrorMessage('Cannot bookmark files outside the workspace. Non-workspace bookmarks are not yet supported.');
        return;
      }

      const fileWorkspaceRoot = fileWorkspaceFolder.uri.fsPath;
      log.debug(`[Add] File: ${absolutePath}, Workspace: ${fileWorkspaceRoot}`);

      // Convert to workspace-relative path
      const relativePath = toWorkspaceRelativePath(absolutePath, fileWorkspaceRoot);
      if (!relativePath) {
        log.error(`[Add] Failed to convert to relative path`);
        vscode.window.showErrorMessage('Cannot bookmark files outside the workspace. Non-workspace bookmarks are not yet supported.');
        return;
      }

      log.debug(`[Add] Relative path: ${relativePath}`);

      const sel = editor.selection;
      const target = await getDefaultTargetForWorkspace(fileWorkspaceRoot, fileWorkspaceFolder);
      await editFileV2(target.paths, (file: BookmarksFileV2) => {
        // if desired group missing, fall back to unsorted
        const groupExists = file.groups.some(g => (g as any).id === target.groupId);
        const groupId = groupExists ? target.groupId : getOrCreateUnsortedGroup(file);
        if (sel && !sel.isEmpty) {
          const start = Math.min(sel.start.line, sel.end.line);
          const end = Math.max(sel.start.line, sel.end.line);
          file.bookmarks.unshift({
            id: nanoid(8),
            fileId: file.fileId,
            groupId,
            target: { uri: relativePath },
            anchor: createAnchor(
              'range',
              editor.document.getText().split('\n'),
              start,
              { lineCacheLength: getLineCacheLength() },
              end
            ),
            label,
            createdAt: Date.now(),
            createdBy: 'extension',
            source: 'extension',
            tags: [],
          } as any);
        } else {
          const line = editor.selection.active.line;
          file.bookmarks.unshift({
            id: nanoid(8),
            fileId: file.fileId,
            groupId,
            target: { uri: relativePath },
            anchor: createAnchor(
              'point',
              editor.document.getText().split('\n'),
              line,
              { lineCacheLength: getLineCacheLength() }
            ),
            label,
            createdAt: Date.now(),
            createdBy: 'extension',
            source: 'extension',
            tags: [],
          } as any);
        }
      });

      provider.refresh();
      await updateDecorations();
    }),

    // Gutter menu: Add Bookmark (no prompt)
    vscode.commands.registerCommand('agenticBookmarks.addAtLine', async (arg?: any) => {
      log.trace(() => `AddAtLine (no-input) invoked; arg=${JSON.stringify(arg ?? null)}`);
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        log.error('No active editor');
        return;
      }

      const line = resolveLineFromArg(arg, editor);

      // Determine which workspace folder this file belongs to
      const absolutePath = editor.document.uri.fsPath;
      const fileWorkspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (!fileWorkspaceFolder) {
        log.error(`[AddAtLine] Cannot find workspace for: ${absolutePath}`);
        vscode.window.showErrorMessage('Cannot bookmark files outside the workspace.');
        return;
      }

      const fileWorkspaceRoot = fileWorkspaceFolder.uri.fsPath;

      // Convert to workspace-relative path
      const relativePath = toWorkspaceRelativePath(absolutePath, fileWorkspaceRoot);
      if (!relativePath) {
        log.error(`[AddAtLine] Failed to convert to relative path`);
        vscode.window.showErrorMessage('Cannot bookmark files outside the workspace.');
        return;
      }

      // Get target first so we can read its settings
      const target = await getDefaultTargetForWorkspace(fileWorkspaceRoot, fileWorkspaceFolder);

      // Read the file and registry to resolve anchor type using the proper waterfall
      const targetFile = await readFileV2Paths(target.paths);
      const registry = await readRegistry(fileWorkspaceRoot);
      const defaultAnchorType = resolveTargetAnchorType(targetFile, registry);

      const blankLinesUseSupport = vscode.workspace.getConfiguration('agenticBookmarks.anchors').get('blankLinesUseSupport', true);
      const lines = editor.document.getText().split('\n');

      // Generate bookmark ID early (needed for tag anchors)
      const bookmarkId = nanoid(8);

      const isLocal = resolveIsLocal(targetFile, target.paths.data, fileWorkspaceRoot);

      // Create anchor based on resolved type (respecting file setting)
      let anchor;
      if (defaultAnchorType === 'tag') {
        anchor = createAnchor('tag', lines, line, { lineCacheLength: getLineCacheLength() }, undefined, bookmarkId);
      } else if (defaultAnchorType === 'smart') {
        anchor = createAnchor('smart', lines, line, {
          isLocal,
          blankLinesUseSupport,
          lineCacheLength: getLineCacheLength(),
        });
      } else {
        anchor = createAnchor('point', lines, line, { lineCacheLength: getLineCacheLength() });
      }

      await editFileV2(target.paths, (file: BookmarksFileV2) => {
        const groupExists = file.groups.some(g => (g as any).id === target.groupId);
        const groupId = groupExists ? target.groupId : getOrCreateUnsortedGroup(file);
        file.bookmarks.unshift({
          id: bookmarkId,
          fileId: file.fileId,
          groupId,
          target: { uri: relativePath },
          anchor,
          label: '',
          createdAt: Date.now(),
          createdBy: 'extension',
          source: 'extension',
          tags: [],
        } as any);
      });

      // Insert tag comment for tag anchors (respects file's tagPlacement setting)
      if (defaultAnchorType === 'tag') {
        const languageId = editor.document.languageId;
        const tagPlacement = resolveTagPlacement(targetFile, registry, languageId);
        const tagInserted = await insertTagComment(editor, line, bookmarkId, tagPlacement);
        if (!tagInserted) {
          log.error(`[AddAtLine] Warning: Failed to insert tag comment for bookmark ${bookmarkId}`);
        }
      }

      log.info(`Added bookmark (no-input) at line ${line + 1} with ${defaultAnchorType} anchor`);
      provider.refresh();
      await updateDecorations();
    }),

    // Gutter menu: Add Labeled Bookmark (prompt for description)
    vscode.commands.registerCommand('agenticBookmarks.addLabeledAtLine', async (arg?: any) => {
      log.trace(() => `AddLabeledAtLine invoked; arg=${JSON.stringify(arg ?? null)}`);
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        log.error('No active editor');
        return;
      }

      const line = resolveLineFromArg(arg, editor);

      const label = await vscode.window.showInputBox({
        prompt: 'Enter bookmark description',
        placeHolder: `Bookmark at line ${line + 1}`
      });
      if (label === undefined) return;

      // Determine which workspace folder this file belongs to
      const absolutePath = editor.document.uri.fsPath;
      const fileWorkspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (!fileWorkspaceFolder) {
        log.error(`[AddLabeledAtLine] Cannot find workspace for: ${absolutePath}`);
        vscode.window.showErrorMessage('Cannot bookmark files outside the workspace.');
        return;
      }

      const fileWorkspaceRoot = fileWorkspaceFolder.uri.fsPath;

      // Convert to workspace-relative path
      const relativePath = toWorkspaceRelativePath(absolutePath, fileWorkspaceRoot);
      if (!relativePath) {
        log.error(`[AddLabeledAtLine] Failed to convert to relative path`);
        vscode.window.showErrorMessage('Cannot bookmark files outside the workspace.');
        return;
      }

      // Get target first so we can read its settings
      const target = await getDefaultTargetForWorkspace(fileWorkspaceRoot, fileWorkspaceFolder);

      // Read the file and registry to resolve anchor type
      const targetFile = await readFileV2Paths(target.paths);
      const registry = await readRegistry(fileWorkspaceRoot);
      const defaultAnchorType = resolveTargetAnchorType(targetFile, registry);

      const blankLinesUseSupport = vscode.workspace.getConfiguration('agenticBookmarks.anchors').get('blankLinesUseSupport', true);
      const lines = editor.document.getText().split('\n');

      // Generate bookmark ID early (needed for tag anchors)
      const bookmarkId = nanoid(8);

      const isLocal = resolveIsLocal(targetFile, target.paths.data, fileWorkspaceRoot);

      // Create anchor based on resolved type (respecting file setting)
      let anchor;
      if (defaultAnchorType === 'tag') {
        anchor = createAnchor('tag', lines, line, { lineCacheLength: getLineCacheLength() }, undefined, bookmarkId);
      } else if (defaultAnchorType === 'smart') {
        anchor = createAnchor('smart', lines, line, {
          isLocal,
          blankLinesUseSupport,
          lineCacheLength: getLineCacheLength(),
        });
      } else {
        anchor = createAnchor('point', lines, line, { lineCacheLength: getLineCacheLength() });
      }

      await editFileV2(target.paths, (file: BookmarksFileV2) => {
        const groupExists = file.groups.some(g => (g as any).id === target.groupId);
        const groupId = groupExists ? target.groupId : getOrCreateUnsortedGroup(file);
        file.bookmarks.unshift({
          id: bookmarkId,
          fileId: file.fileId,
          groupId,
          target: { uri: relativePath },
          anchor,
          label: label || `Ln ${line + 1}`,
          createdAt: Date.now(),
          createdBy: 'extension',
          source: 'extension',
          tags: [],
        } as any);
      });

      // Insert tag comment for tag anchors
      if (defaultAnchorType === 'tag') {
        const languageId = editor.document.languageId;
        const tagPlacement = resolveTagPlacement(targetFile, registry, languageId);
        const tagInserted = await insertTagComment(editor, line, bookmarkId, tagPlacement);
        if (!tagInserted) {
          log.error(`[AddLabeledAtLine] Warning: Failed to insert tag comment for bookmark ${bookmarkId}`);
        }
      }

      log.info(`Added labeled bookmark at line ${line + 1} with ${defaultAnchorType} anchor`);
      provider.refresh();
      await updateDecorations();
    }),

    // Remove bookmark at line
    vscode.commands.registerCommand('agenticBookmarks.removeAtLine', async (arg?: any) => {
      log.trace(() => `RemoveAtLine invoked; arg=${JSON.stringify(arg ?? null)}`);
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        log.error('No active editor');
        return;
      }

      const line = resolveLineFromArg(arg, editor);
      const uri = editor.document.uri.toString();
      const fsPath = vscode.Uri.parse(uri).fsPath;
      log.info(`RemoveAtLine: request file=${fsPath} line=${line + 1}`);

      const fileWorkspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (!fileWorkspaceFolder) {
        log.error(`[RemoveAtLine] Cannot find workspace for: ${fsPath}`);
        vscode.window.showErrorMessage('Cannot remove bookmarks for files outside the workspace.');
        return;
      }
      const fileWorkspaceRoot = fileWorkspaceFolder.uri.fsPath;

      // Track tag anchors to remove their comments from source files
      const tagAnchorsToRemove: Array<{ tagId: string; line: number }> = [];

      try {
        const reg = await readRegistry(fileWorkspaceRoot);
        const dataRoot = getConfiguredDataRoot(fileWorkspaceFolder);
        const enabled = reg.files.filter(f => f.enabled !== false);
        let totalRemoved = 0;
        for (const rf of enabled) {
          const p = pathsForDataFile(rf.path, fileWorkspaceRoot, dataRoot);
          await editFileV2(p as any, (file: BookmarksFileV2) => {
            const before = file.bookmarks.length;
            file.bookmarks = file.bookmarks.filter(b => {
              const base = b.target.uri.split('#')[0];
              let bFs = '';

              if (base.startsWith('file://')) {
                try { bFs = vscode.Uri.parse(base).fsPath; } catch { bFs = base; }
              } else {
                try {
                  const absoluteUri = workspaceRelativeToUri(base, fileWorkspaceRoot);
                  bFs = vscode.Uri.parse(absoluteUri).fsPath;
                } catch { bFs = base; }
              }

              if (bFs !== fsPath) return true;
              if (b.anchor.kind === 'point') {
                const keep = b.anchor.line !== line;
                if (!keep) log.info(`RemoveAtLine: removing point id=${(b as any).id} label="${b.label}" from ${vscode.workspace.asRelativePath(rf.path)}`);
                return keep;
              } else if (b.anchor.kind === 'range') {
                const keep = b.anchor.start.line !== line;
                if (!keep) log.info(`RemoveAtLine: removing range id=${(b as any).id} [${b.anchor.start.line + 1}..${b.anchor.end.line + 1}] label="${b.label}" from ${vscode.workspace.asRelativePath(rf.path)}`);
                return keep;
              } else if (b.anchor.kind === 'tag') {
                const effective = effectiveAnchorLine(b.anchor, () => getResolvedLine(uri, (b as any).id));
                const keep = effective !== line;
                if (!keep) {
                  log.info(`RemoveAtLine: removing tag id=${(b as any).id} label="${b.label}" from ${vscode.workspace.asRelativePath(rf.path)}`);
                  tagAnchorsToRemove.push({ tagId: b.anchor.tagId, line: effective });
                }
                return keep;
              } else if (b.anchor.kind === 'smart') {
                const effective = effectiveAnchorLine(b.anchor, () => getResolvedLine(uri, (b as any).id));
                const keep = effective !== line;
                if (!keep) log.info(`RemoveAtLine: removing smart id=${(b as any).id} label="${b.label}" from ${vscode.workspace.asRelativePath(rf.path)}`);
                return keep;
              } else {
                return true;
              }
            });
            const removed = before - file.bookmarks.length;
            if (removed > 0) {
              totalRemoved += removed;
              log.info(`RemoveAtLine: ${removed} removed in ${vscode.workspace.asRelativePath(rf.path)} (${before} -> ${file.bookmarks.length})`);
            }
          });
        }
        if (totalRemoved === 0) {
          log.info('RemoveAtLine: no matching bookmarks found to remove');
        } else {
          log.info(`RemoveAtLine: total removed across files = ${totalRemoved}`);
        }

        // Remove tag comments from the source file for any tag anchors that were removed
        if (tagAnchorsToRemove.length > 0 && editor) {
          for (const { tagId, line: tagLine } of tagAnchorsToRemove) {
            const removed = await removeTagComment(editor.document, tagLine, tagId);
            if (removed) {
              log.info(`RemoveAtLine: removed tag comment @bookmark:${tagId} from line ${tagLine + 1}`);
            } else {
              log.info(`RemoveAtLine: tag comment @bookmark:${tagId} not found on line ${tagLine + 1} (may have been moved)`);
            }
          }
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Remove bookmark failed: ${e}`);
      }

      provider.refresh();
      filesGroups.refresh();
      await updateDecorations();
    }),

    // Toggle bookmark on current line (no label)
    vscode.commands.registerCommand('agenticBookmarks.toggle', (arg?: any) =>
      runToggle(arg, { promptForLabel: false })
    ),

    // Toggle labeled bookmark on current line (prompts when adding)
    vscode.commands.registerCommand('agenticBookmarks.toggleLabeled', (arg?: any) =>
      runToggle(arg, { promptForLabel: true })
    ),

    // Edit bookmark label
    vscode.commands.registerCommand('agenticBookmarks.edit', async (node: BookmarkNode) => {
      if (!node) return;
      const nodeWsRoot = node.workspaceRoot || workspaceRoot;
      const reg = await readRegistry(nodeWsRoot);
      const dataRoot = getBookmarksDataRoot(reg);
      const targetPaths = pathsForDataFile(node.dataFilePath, nodeWsRoot, dataRoot);
      const file = await readFileV2(targetPaths);
      const bookmark = file.bookmarks.find(b => b.id === node.id);
      if (!bookmark) return;

      const newLabel = await vscode.window.showInputBox({
        prompt: 'Edit bookmark description',
        value: bookmark.label
      });

      if (newLabel === undefined) return;

      await editFileV2(targetPaths, (file: BookmarksFileV2) => {
        const item = file.bookmarks.find(b => b.id === node.id);
        if (item) item.label = newLabel;
      });

      provider.refresh();
    }),

    // Edit bookmark note (longer-form free-text). Empty/whitespace input clears
    // the note. Two command IDs share one handler so the menu can show
    // "Add Note" or "Edit Note" based on note presence (per-entry titles in
    // VS Code menus require distinct command IDs).
    ...['agenticBookmarks.addNote', 'agenticBookmarks.editNote'].map(cmdId =>
      vscode.commands.registerCommand(cmdId, async (node: BookmarkNode) => {
        if (!node) return;
        const nodeWsRoot = node.workspaceRoot || workspaceRoot;
        const reg = await readRegistry(nodeWsRoot);
        const dataRoot = getBookmarksDataRoot(reg);
        const targetPaths = pathsForDataFile(node.dataFilePath, nodeWsRoot, dataRoot);
        const file = await readFileV2(targetPaths);
        const bookmark = file.bookmarks.find(b => b.id === node.id);
        if (!bookmark) return;

        const hasNote = !!(bookmark.note && bookmark.note.trim().length > 0);
        const newNote = await vscode.window.showInputBox({
          prompt: hasNote ? 'Edit bookmark note (clear to remove)' : 'Add bookmark note',
          value: bookmark.note ?? '',
        });

        if (newNote === undefined) return;

        await editFileV2(targetPaths, (file: BookmarksFileV2) => {
          const item = file.bookmarks.find(b => b.id === node.id);
          if (!item) return;
          if (newNote.trim().length === 0) {
            delete (item as any).note;
          } else {
            item.note = newNote;
          }
          item.updatedAt = Date.now();
        });

        provider.refresh();
      })
    ),

    // Delete bookmark
    vscode.commands.registerCommand('agenticBookmarks.delete', async (node: BookmarkNode) => {
      if (!node) return;
      const nodeWsRoot = node.workspaceRoot || workspaceRoot;
      const reg = await readRegistry(nodeWsRoot);
      const dataRoot = getBookmarksDataRoot(reg);
      const targetPaths = pathsForDataFile(node.dataFilePath, nodeWsRoot, dataRoot);
      await editFileV2(targetPaths, (file: BookmarksFileV2) => {
        const index = file.bookmarks.findIndex(b => b.id === node.id);
        if (index >= 0) file.bookmarks.splice(index, 1);
      });

      provider.refresh();
      await updateDecorations();
    }),

    // Open bookmark
    vscode.commands.registerCommand('agenticBookmarks.open', async (node: BookmarkNode) => {
      if (!node) return;
      const bookmark = node.bookmark;
      const nodeWsRoot = node.workspaceRoot || workspaceRoot;

      try {
        // Resolve URI - handle both absolute file:// URIs and workspace-relative paths
        let absoluteUri: string;
        if (bookmark.target.uri.startsWith('file://')) {
          absoluteUri = bookmark.target.uri;
        } else {
          absoluteUri = workspaceRelativeToUri(bookmark.target.uri, nodeWsRoot);
        }

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(absoluteUri).with({ fragment: '' }));
        const editor = await vscode.window.showTextDocument(doc);
        if (bookmark.anchor.kind === 'point') {
          const line = bookmark.anchor.line;
          const range = new vscode.Range(line, 0, line, 0);
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        } else if (bookmark.anchor.kind === 'range') {
          const s = bookmark.anchor.start.line;
          const e = bookmark.anchor.end.line;
          const sel = new vscode.Selection(new vscode.Position(s, 0), new vscode.Position(e, 0));
          editor.selection = sel;
          editor.revealRange(new vscode.Range(s, 0, e, 0), vscode.TextEditorRevealType.InCenter);
        } else if (bookmark.anchor.kind === 'smart' || bookmark.anchor.kind === 'tag') {
          // Use resolved line from anchorState if available, fall back to recorded line
          const resolved = getResolvedLine(absoluteUri, bookmark.id);
          const line = resolved ?? bookmark.anchor.lastUpdatedLine;
          const range = new vscode.Range(line, 0, line, 0);
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

          // If anchorState wasn't ready (file just opened), re-check after resolution
          if (resolved === undefined) {
            setTimeout(() => {
              const newResolved = getResolvedLine(absoluteUri, bookmark.id);
              if (newResolved !== undefined && newResolved !== line) {
                const r = new vscode.Range(newResolved, 0, newResolved, 0);
                editor.selection = new vscode.Selection(r.start, r.end);
                editor.revealRange(r, vscode.TextEditorRevealType.InCenter);
              }
            }, 500);
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isFileNotFound = errorMsg.includes('Unable to resolve nonexistent file')
          || errorMsg.includes('ENOENT')
          || errorMsg.includes('cannot open file');

        if (!isFileNotFound) {
          vscode.window.showErrorMessage(`Failed to open bookmark: ${errorMsg}`);
          return;
        }

        // File not found: mark broken and attempt repair
        let absoluteUri: string;
        try {
          if (bookmark.target.uri.startsWith('file://')) {
            absoluteUri = bookmark.target.uri;
          } else {
            absoluteUri = workspaceRelativeToUri(bookmark.target.uri, nodeWsRoot);
          }
        } catch {
          absoluteUri = bookmark.target.uri;
        }

        markBookmarkBroken(absoluteUri, bookmark.id, 'not_found', 'Original file no longer exists');
        provider.refresh();
        filesGroups.refresh();
        debouncedCacheSync();

        const autoRepairEnabled = vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepair', true);

        if (autoRepairEnabled) {
          vscode.window.showInformationMessage('Attempting auto-repair — original file missing...');

          const repairResult = await runFileMoveRepairForBookmark(bookmark.id, nodeWsRoot, repairDeps);

          if (repairResult.status === 'repaired' && repairResult.newFilePath) {
            vscode.window.showInformationMessage(
              `Auto-repair succeeded — file moved to ${repairResult.newFilePath}`
            );
            try {
              const newUri = workspaceRelativeToUri(repairResult.newFilePath, nodeWsRoot);
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(newUri));
              const editor = await vscode.window.showTextDocument(doc);
              const line = repairResult.newLine ?? 0;
              const range = new vscode.Range(line, 0, line, 0);
              editor.selection = new vscode.Selection(range.start, range.end);
              editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            } catch {
              // Jump failed - non-critical
            }
          } else {
            const reason = repairResult.reason || 'could not find file';
            vscode.window.showWarningMessage(
              `Auto-repair failed: ${reason}. Click the wrench icon to retry, or ask your agent: "${buildAgentRepairPrompt(bookmark.id)}"`
            );
          }
        } else {
          vscode.window.showWarningMessage(
            `File not found. Auto-repair is disabled. Click the wrench icon to try auto-repair, or ask your agent: "${buildAgentRepairPrompt(bookmark.id)}"`
          );
        }
      }
    }),

    // Clear all bookmarks for the active editor's file (across groups)
    vscode.commands.registerCommand('agenticBookmarks.clearFile', async () => {
      log.trace(() => 'ClearFile invoked');
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }
      const fsPath = editor.document.uri.fsPath;
      const fileWorkspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (!fileWorkspaceFolder) {
        log.error(`[ClearFile] Cannot find workspace for: ${fsPath}`);
        vscode.window.showErrorMessage('Cannot clear bookmarks for files outside the workspace.');
        return;
      }
      const fileWorkspaceRoot = fileWorkspaceFolder.uri.fsPath;
      await runClear({
        title: vscode.workspace.asRelativePath(fsPath),
        predicate: (b) => bookmarkMatchesActiveFile(b, fsPath, fileWorkspaceRoot),
        activeEditor: editor,
        folders: [fileWorkspaceFolder],
      });
    }),

    // Clear all bookmarks across every enabled registered file
    vscode.commands.registerCommand('agenticBookmarks.clearAll', async () => {
      log.trace(() => 'ClearAll invoked');
      await runClear({
        title: 'all registered files',
        predicate: () => true,
        activeEditor: vscode.window.activeTextEditor ?? null,
        folders: vscode.workspace.workspaceFolders ? [...vscode.workspace.workspaceFolders] : [],
      });
    }),
  ];
}
