/**
 * Group management commands extracted from extension.ts.
 *
 * Commands:
 *   agenticBookmarks.changeGroup
 *   agenticBookmarks.newGroup
 *   agenticBookmarks.groupRename
 *   agenticBookmarks.groupMove
 *   agenticBookmarks.groupSetDefault
 *   agenticBookmarks.groupDelete
 *   agenticBookmarks.groupToggleVisibility
 *   agenticBookmarks.groupToggleFocus
 *   agenticBookmarks.clearGroupFilter
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  pathsForDataFile,
  editFileV2,
  readFileV2,
  readRegistry,
  getBookmarksDataRoot,
  getOrCreateUnsortedGroup,
  renameGroupGlobal,
  moveGroupBetweenFiles,
  createGroupInFile,
  deleteGroupInFile,
  setDefaultTargetByPath,
  resolveWorkspacePath,
  type BookmarksFileV2,
} from '@agentic-bookmarks/core';
import type { BookmarkNode } from '../treeProvider';
import type { GroupNode, RegFileNode, FilesGroupsProvider } from '../filesGroupsProvider';
import type { Logger } from '../logger';
import type { BookmarksProvider } from '../treeProvider';
import {
  areInSameWorkspace,
  getWorkspaceForBookmarkNode,
  getWorkspaceForGroupNode,
  getConfiguredDataRoot,
} from '../workspace-helpers';
import { moveBookmarkAcrossFiles } from './group-management-helpers';

type UIState = { hidden: string[]; focus: string | null; filterEnabled?: boolean; hiddenFiles?: string[] };
type SearchFilter = { id: string; text: string; regex: boolean; op: 'AND' | 'OR' };

export interface GroupManagementDeps {
  workspaceRoot: string;
  log: Logger;
  provider: BookmarksProvider;
  filesGroups: FilesGroupsProvider;
  updateDecorations: () => Promise<void>;
  getUIState: () => UIState & { searches?: SearchFilter[] };
  setUIState: (next: UIState & { searches?: SearchFilter[] }) => Promise<void>;
}

/**
 * Execute a group move between bookmark files within a workspace.
 *
 * Performs the move via `moveGroupBetweenFiles`, surfaces conversion-issue
 * notifications, applies any tag insertions/removals to source files, and
 * refreshes the affected tree views and decorations.
 *
 * Callers are responsible for prior validation (workspace membership, dest
 * file selection, etc.). Paths may be workspace-relative or absolute; they
 * are resolved against `wsRoot` here.
 */
export async function executeGroupMove(
  deps: Pick<GroupManagementDeps, 'workspaceRoot' | 'log' | 'provider' | 'filesGroups' | 'updateDecorations'>,
  groupId: string,
  groupName: string,
  srcFilePath: string,
  dstFilePath: string,
  wsRoot: string
): Promise<void> {
  const { log, provider, filesGroups, updateDecorations } = deps;
  try {
    const resolvedSrc = path.isAbsolute(srcFilePath) ? srcFilePath : path.join(wsRoot, srcFilePath);
    const resolvedDst = path.isAbsolute(dstFilePath) ? dstFilePath : path.join(wsRoot, dstFilePath);

    log.trace(`[GroupMove] srcFilePath (resolved): ${resolvedSrc}`);
    log.trace(`[GroupMove] destFilePath (resolved): ${resolvedDst}`);
    log.trace(`[GroupMove] wsRoot: ${wsRoot}`);

    const moveResult = await moveGroupBetweenFiles(wsRoot, resolvedSrc, resolvedDst, groupId);

    if (moveResult.conversionIssues.length > 0) {
      const issueCount = moveResult.conversionIssues.length;
      vscode.window.showWarningMessage(
        `Moved group "${groupName}". ${issueCount} bookmark(s) had conversion issues.`,
        'Show Details'
      ).then(selection => {
        if (selection === 'Show Details') {
          const details = moveResult.conversionIssues
            .map(i => `• ${i.bookmarkId}: ${i.reason}`)
            .join('\n');
          vscode.window.showInformationMessage(details, { modal: true });
        }
      });
    } else {
      vscode.window.showInformationMessage(
        `Moved group "${groupName}" with ${moveResult.movedCount} bookmarks.`
      );
    }

    // Handle tag insertions
    for (const insertion of moveResult.tagInsertions) {
      try {
        const targetPath = resolveWorkspacePath(insertion.file, wsRoot);
        const doc = await vscode.workspace.openTextDocument(targetPath);
        const edit = new vscode.WorkspaceEdit();

        if (insertion.placement === 'inline') {
          const line = doc.lineAt(insertion.line);
          edit.insert(doc.uri, line.range.end, ` ${insertion.comment}`);
        } else {
          const position = new vscode.Position(insertion.line, 0);
          edit.insert(doc.uri, position, `${insertion.comment}\n`);
        }

        await vscode.workspace.applyEdit(edit);
        await doc.save();
        log.trace(`[GroupMove] Inserted tag comment: ${insertion.comment} at ${insertion.file}:${insertion.line}`);
      } catch (err) {
        const errMsg = `Failed to insert tag comment ${insertion.comment}: ${err}`;
        log.error(`[GroupMove] ERROR: ${errMsg}`);
        vscode.window.showWarningMessage(errMsg);
      }
    }

    // Handle tag removals
    for (const removal of moveResult.tagRemovals) {
      try {
        const targetPath = resolveWorkspacePath(removal.file, wsRoot);
        const doc = await vscode.workspace.openTextDocument(targetPath);
        const text = doc.getText();
        const lines = text.split('\n');

        const edit = new vscode.WorkspaceEdit();

        const tagIdMatch = removal.pattern.match(/@bookmark:(\S+)/);
        const tagId = tagIdMatch ? tagIdMatch[1] : removal.pattern;
        const escapedTagId = tagId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const TAG_TAIL = '(?![A-Za-z0-9_-])';
        const tagPattern = new RegExp(`\\s*//\\s*@bookmark:${escapedTagId}${TAG_TAIL}|\\s*#\\s*@bookmark:${escapedTagId}${TAG_TAIL}|\\s*/\\*\\s*@bookmark:${escapedTagId}\\s*\\*/`, 'g');

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(removal.pattern)) {
            const newLine = lines[i].replace(tagPattern, '');
            const lineRange = doc.lineAt(i).range;

            if (newLine.trim() === '') {
              edit.delete(doc.uri, lineRange.with(undefined, new vscode.Position(i + 1, 0)));
            } else {
              edit.replace(doc.uri, lineRange, newLine);
            }
            break;
          }
        }

        await vscode.workspace.applyEdit(edit);
        await doc.save();
        log.trace(`[GroupMove] Removed tag comment: ${removal.pattern} from ${removal.file}:${removal.line}`);
      } catch (err) {
        const errMsg = `Failed to remove tag comment ${removal.pattern}: ${err}`;
        log.error(`[GroupMove] ERROR: ${errMsg}`);
        vscode.window.showWarningMessage(errMsg);
      }
    }

    log.debug(`[GroupMove] Refreshing tree views after group move completion`);
    provider.refresh();
    filesGroups.refresh();
    await updateDecorations();
  } catch (e) {
    const errMsg = `Move failed: ${e}`;
    log.error(`[GroupMove] FATAL ERROR: ${errMsg}`);
    vscode.window.showErrorMessage(errMsg);
    try {
      provider.refresh();
      filesGroups.refresh();
    } catch (refreshErr) {
      log.error(`[GroupMove] ERROR: Failed to refresh UI: ${refreshErr}`);
    }
  }
}

export function registerGroupManagementCommands(deps: GroupManagementDeps): vscode.Disposable[] {
  const {
    workspaceRoot,
    log,
    provider,
    filesGroups,
    updateDecorations,
    getUIState,
    setUIState,
  } = deps;

  return [
    // Change group for a bookmark (can move across files within same workspace)
    vscode.commands.registerCommand('agenticBookmarks.changeGroup', async (node: BookmarkNode) => {
      if (!node) return;
      try {
        const bookmarkWorkspace = getWorkspaceForBookmarkNode(node);
        if (!bookmarkWorkspace) {
          vscode.window.showErrorMessage('Could not determine workspace for bookmark');
          return;
        }

        const nodeWorkspaceRoot = bookmarkWorkspace.uri.fsPath;
        const reg = await readRegistry(nodeWorkspaceRoot);
        const dataRoot = getBookmarksDataRoot(reg);
        const enabledFiles = reg.files.filter(f => f.enabled !== false);

        type Pick = vscode.QuickPickItem & { data?: { filePath: string; fileId: string; groupId: string } };
        const items: Pick[] = [];
        for (const f of enabledFiles) {
          items.push({ label: vscode.workspace.asRelativePath(f.path), kind: vscode.QuickPickItemKind.Separator } as any);
          try {
            const filePaths = pathsForDataFile(f.path, nodeWorkspaceRoot, dataRoot);
            const file = await readFileV2(filePaths);
            for (const g of file.groups) {
              if (f.path === node.dataFilePath && (g as any).id === node.bookmark.groupId) {
                continue;
              }
              items.push({
                label: g.name,
                description: path.basename(f.path),
                data: { filePath: f.path, fileId: file.fileId as any, groupId: g.id as any }
              });
            }
          } catch (err) {
            console.error(`[changeGroup] Error reading bookmark file ${f.path} for group selection:`, err);
            log.error(`[changeGroup] ERROR: Failed to read file for group selection: ${err}`);
          }
        }

        if (items.filter(i => i.data).length === 0) {
          vscode.window.showInformationMessage(
            `No other groups available in workspace "${bookmarkWorkspace.name}"`
          );
          return;
        }

        const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select destination group', matchOnDescription: true });
        if (!pick || !pick.data) return;

        const target = pick.data;

        if (target.filePath !== node.dataFilePath) {
          if (!areInSameWorkspace(node.dataFilePath, target.filePath)) {
            vscode.window.showErrorMessage(
              `Cannot move bookmarks between workspaces. Source and destination must be in workspace "${bookmarkWorkspace.name}".`
            );
            return;
          }
        }

        const srcPaths = pathsForDataFile(node.dataFilePath, nodeWorkspaceRoot, dataRoot);
        if (target.filePath === node.dataFilePath) {
          await editFileV2(srcPaths, (file: any) => {
            const b = file.bookmarks.find((x: any) => x.id === node.id);
            if (b) b.groupId = target.groupId;
          });
        } else {
          const dstPaths = pathsForDataFile(target.filePath, nodeWorkspaceRoot, dataRoot);
          await moveBookmarkAcrossFiles({ readFileV2, editFileV2 }, srcPaths, dstPaths, node.id, target.groupId);
        }

        provider.refresh();
        filesGroups.refresh();
        await updateDecorations();
      } catch (e) {
        vscode.window.showErrorMessage(`Change group failed: ${e}`);
      }
    }),

    // Create new group
    vscode.commands.registerCommand('agenticBookmarks.newGroup', async (node?: RegFileNode) => {
      const nodeWsRoot = node?.workspaceRoot || workspaceRoot;
      const reg = await readRegistry(nodeWsRoot);
      let dataPath: string | undefined = node?.reg.path;
      if (!dataPath) {
        const pick = await vscode.window.showQuickPick(reg.files.map(f => ({ label: vscode.workspace.asRelativePath(f.path), description: f.path })), { placeHolder: 'Select file for new group' });
        if (!pick) return; dataPath = pick.description;
      }
      const name = await vscode.window.showInputBox({ prompt: 'Group name' });
      if (!name) return;
      try { await createGroupInFile(nodeWsRoot, dataPath!, name); filesGroups.refresh(); }
      catch (e) { vscode.window.showErrorMessage(String(e)); }
    }),

    // Rename group (global uniqueness enforced)
    vscode.commands.registerCommand('agenticBookmarks.groupRename', async (node: GroupNode) => {
      if (!node) return;
      const nodeWsRoot = node.workspaceRoot || workspaceRoot;
      const newName = await vscode.window.showInputBox({ prompt: 'New group name', value: node.group.name });
      if (!newName) return;
      try {
        await renameGroupGlobal(nodeWsRoot, node.dataFilePath, (node.group as any).id, newName);
        filesGroups.refresh();
      } catch (e) {
        vscode.window.showErrorMessage(`Rename failed: ${e}`);
      }
    }),

    // Move group to another registered file
    vscode.commands.registerCommand('agenticBookmarks.groupMove', async (node: GroupNode) => {
      if (!node) return;
      try {
        const groupWorkspace = getWorkspaceForGroupNode(node);
        if (!groupWorkspace) {
          vscode.window.showErrorMessage('Could not determine workspace for group');
          return;
        }

        const nodeWorkspaceRoot = groupWorkspace.uri.fsPath;
        const reg = await readRegistry(nodeWorkspaceRoot);

        const sameWorkspaceFiles = reg.files.filter(f => {
          if (f.enabled === false) return false;
          if (f.path === node.dataFilePath) return false;
          return true;
        });

        if (sameWorkspaceFiles.length === 0) {
          vscode.window.showInformationMessage(
            `No other bookmark files available in workspace "${groupWorkspace.name}". Create a new file first.`
          );
          return;
        }

        const picks = sameWorkspaceFiles.map(f => ({
          label: f.title || path.basename(f.path),
          description: vscode.workspace.asRelativePath(f.path),
          filePath: f.path
        }));

        const pick = await vscode.window.showQuickPick(picks, {
          placeHolder: 'Select destination file for group'
        });

        if (!pick) return;

        log.trace(`[GroupMove] node.dataFilePath: ${node.dataFilePath}`);

        await executeGroupMove(
          { workspaceRoot, log, provider, filesGroups, updateDecorations },
          (node.group as any).id,
          node.group.name,
          node.dataFilePath,
          pick.filePath,
          nodeWorkspaceRoot
        );
      } catch (e) {
        const errMsg = `Move failed: ${e}`;
        log.error(`[GroupMove] FATAL ERROR: ${errMsg}`);
        vscode.window.showErrorMessage(errMsg);
        try {
          provider.refresh();
          filesGroups.refresh();
        } catch (refreshErr) {
          log.error(`[GroupMove] ERROR: Failed to refresh UI: ${refreshErr}`);
        }
      }
    }),

    // Set group as default target (toggle off returns to Unsorted)
    vscode.commands.registerCommand('agenticBookmarks.groupSetDefault', async (node: GroupNode) => {
      if (!node) return;
      try {
        const nodeWsRoot = node.workspaceRoot || workspaceRoot;
        const reg = await readRegistry(nodeWsRoot);
        const current = reg.defaultTarget;
        const dataRoot = getBookmarksDataRoot(reg);
        const targetPaths = pathsForDataFile(node.dataFilePath, nodeWsRoot, dataRoot);
        const file = await readFileV2(targetPaths);
        const groupId = (node.group as any).id as string;
        const isAlreadyDefault = !!current && (current.fileId === (file.fileId as any)) && (current.groupId === groupId);
        if (isAlreadyDefault) {
          let unsortedId: string | undefined;
          await editFileV2(targetPaths, (f: BookmarksFileV2) => {
            unsortedId = getOrCreateUnsortedGroup(f) as any;
          });
          if (unsortedId) {
            await setDefaultTargetByPath(nodeWsRoot, node.dataFilePath, unsortedId);
            vscode.window.showInformationMessage(`Default target set to Unsorted`);
          }
        } else {
          await setDefaultTargetByPath(nodeWsRoot, node.dataFilePath, groupId);
          vscode.window.showInformationMessage(`Default target set to ${node.group.name}`);
        }
        filesGroups.refresh();
        provider.refresh();
      } catch (e) {
        vscode.window.showErrorMessage(`Set default failed: ${e}`);
      }
    }),

    // Delete/Clear group
    vscode.commands.registerCommand('agenticBookmarks.groupDelete', async (node: GroupNode) => {
      if (!node) return;
      const nodeWsRoot = node.workspaceRoot || workspaceRoot;
      const isUnsorted = !!(node.group as any).isUnsorted;
      const action = isUnsorted ? 'Clear' : 'Delete';
      const msg = isUnsorted ? `Clear all bookmarks from '${node.group.name}'?` : `Delete group '${node.group.name}' and its bookmarks?`;
      const confirm = await vscode.window.showWarningMessage(msg, { modal: true }, action);
      if (confirm !== action) return;
      try {
        await deleteGroupInFile(nodeWsRoot, node.dataFilePath, (node.group as any).id);
        filesGroups.refresh();
      } catch (e) {
        vscode.window.showErrorMessage(`${action} failed: ${e}`);
      }
    }),

    // Visibility toggle for a group
    vscode.commands.registerCommand('agenticBookmarks.groupToggleVisibility', async (node: GroupNode) => {
      if (!node) return;
      const ui = getUIState();
      const gid = (node.group as any).id as string;
      const hidden = new Set(ui.hidden);
      if (hidden.has(gid)) hidden.delete(gid); else hidden.add(gid);
      await setUIState({ ...ui, hidden: Array.from(hidden) });
      filesGroups.refresh();
      provider.refresh();
      await updateDecorations();
    }),

    // Focus/unfocus a group
    vscode.commands.registerCommand('agenticBookmarks.groupToggleFocus', async (node: GroupNode) => {
      if (!node) return;
      const ui = getUIState();
      const gid = (node.group as any).id as string;
      const nextFocus = ui.focus === gid ? null : gid;
      await setUIState({ ...ui, focus: nextFocus });

      if (nextFocus !== null) {
        const focusSetsDefault = vscode.workspace.getConfiguration('agenticBookmarks').get('focusSetsDefault', true);
        if (focusSetsDefault) {
          const nodeWsRoot = node.workspaceRoot || workspaceRoot;
          await setDefaultTargetByPath(nodeWsRoot, node.dataFilePath, gid);
        }
      }

      filesGroups.refresh();
      provider.refresh();
      await updateDecorations();
    }),

    // Clear hidden/focus filters
    vscode.commands.registerCommand('agenticBookmarks.clearGroupFilter', async () => {
      const ui = getUIState();
      await setUIState({ ...ui, hidden: [], focus: null });
      filesGroups.refresh();
      provider.refresh();
      await updateDecorations();
    }),
  ];
}
