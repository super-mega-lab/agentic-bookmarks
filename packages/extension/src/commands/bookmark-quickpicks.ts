// ABOUTME: Vscode glue for bookmark list quick-picks — registers listInFile (live preview)
// ABOUTME: and listAll (open-on-accept). Uses buildBookmarkPickItems for the pure assembly.

/**
 * Bookmark quick-pick commands.
 *
 * Commands:
 *   agenticBookmarks.listInFile  — quick-pick of bookmarks in the active editor
 *                               (live cursor preview on highlight, restore on cancel)
 *   agenticBookmarks.listAll     — quick-pick across all registered files
 *                               (opens the file at the line on accept)
 */

import * as vscode from 'vscode';
import {
  type WorkspaceRegistryV1,
} from '@agentic-bookmarks/core';
import type { Logger } from '../logger';
import {
  resolveGroupIconPath,
  type EffectiveCatalog,
  type AppearanceOverrides,
} from '../appearance';
import {
  buildBookmarkPickItems,
  type BookmarkPickItem,
  type SearchFilter,
} from './bookmark-quickpick-items';
import {
  loadAllFolders,
  makeResolveLine,
  type LoadedFile,
  type LoadedFolder,
} from './bookmark-loaders';

export interface BookmarkQuickpicksDeps {
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
  getCatalog: () => Promise<EffectiveCatalog | null>;
  defaultIconPath: string;
}

type Pick = vscode.QuickPickItem & { idx: number };

/**
 * Resolve an icon Uri per unique groupId in `items`. Uses `resolveGroupIconPath`
 * with the workspace's appearance overrides; falls back to `defaultIconPath` on
 * any error so the picker stays usable when assets are missing.
 */
async function buildIconCache(
  items: BookmarkPickItem[],
  filesData: LoadedFile[],
  foldersByRoot: Map<string, LoadedFolder>,
  catalog: EffectiveCatalog | null,
  defaultIconPath: string,
): Promise<Map<string, vscode.Uri | undefined>> {
  const iconCache = new Map<string, vscode.Uri | undefined>();
  // Pre-build groupId -> {group, owningFile} so the per-item lookup is O(1).
  const groupIndex = new Map<string, { group: any; owningFile: LoadedFile }>();
  for (const f of filesData) {
    const groups = ((f.data as any).groups as any[]) ?? [];
    for (const g of groups) {
      if (!groupIndex.has(g.id)) groupIndex.set(g.id, { group: g, owningFile: f });
    }
  }
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.groupId)) continue;
    seen.add(it.groupId);
    const found = groupIndex.get(it.groupId);
    if (!found) {
      iconCache.set(it.groupId, vscode.Uri.file(defaultIconPath));
      continue;
    }
    const folder = foldersByRoot.get(found.owningFile.wsRoot);
    const appearance: AppearanceOverrides | undefined = folder?.reg.settings?.appearance;
    try {
      const abs = await resolveGroupIconPath(
        found.group,
        found.owningFile.wsRoot,
        catalog,
        defaultIconPath,
        found.owningFile.dataRoot,
        appearance,
      );
      iconCache.set(it.groupId, abs ? vscode.Uri.file(abs) : undefined);
    } catch {
      iconCache.set(it.groupId, vscode.Uri.file(defaultIconPath));
    }
  }
  return iconCache;
}

export function registerBookmarkQuickpicksCommands(
  deps: BookmarkQuickpicksDeps,
): vscode.Disposable[] {
  const { workspaceRoot, log, getUIState, isFileHidden, getCatalog, defaultIconPath } = deps;

  return [
    vscode.commands.registerCommand('agenticBookmarks.listInFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const activeFileFsPath = editor.document.uri.fsPath;

      const { folders, filesData } = await loadAllFolders(log, workspaceRoot);
      const foldersByRoot = new Map(folders.map(f => [f.wsRoot, f]));

      const ui = getUIState();
      const visibility = {
        hidden: ui.hidden,
        focus: ui.focus,
        filterEnabled: ui.filterEnabled === true,
        searches: ui.searches,
      };

      // Bookmarks may belong to any workspace folder's registry; consult the
      // owning folder's registry for the per-file isFileHidden check.
      const fileFolderById = new Map<string, LoadedFolder>();
      for (const f of filesData) {
        const fileId = (f.data as any).fileId as string;
        const folder = foldersByRoot.get(f.wsRoot);
        if (folder) fileFolderById.set(fileId, folder);
      }
      const composedIsFileHidden = (fileId: string): boolean => {
        const folder = fileFolderById.get(fileId);
        if (!folder) return false;
        if (!isFileHidden(fileId, folder.reg)) return false;
        // Bullseye trumps file-level UI-hide (extends SML-1380's focus-wins
        // precedence to the file boundary). Registry-disable still wins.
        const file = folder.reg.files.find((x: any) => x.fileId === fileId);
        if ((file as any)?.enabled === false) return true;
        return !(visibility.filterEnabled && visibility.focus !== null);
      };

      const items = buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath,
        visibility,
        filesData,
        // `registry` is unused by the helper; pass any folder's registry to
        // satisfy the type. Multi-root file-hidden semantics are handled by
        // composedIsFileHidden above.
        registry: folders[0]?.reg ?? ({ files: [] } as unknown as WorkspaceRegistryV1),
        isFileHidden: composedIsFileHidden,
        resolveLine: makeResolveLine(),
      });

      if (items.length === 0) {
        vscode.window.showInformationMessage('No bookmarks in this file');
        return;
      }

      const catalog = await getCatalog();
      const iconCache = await buildIconCache(
        items,
        filesData,
        foldersByRoot,
        catalog,
        defaultIconPath,
      );

      const capturedEditor = editor;
      const originalSelection = editor.selection;
      const originalVisibleRange = editor.visibleRanges[0];

      const qpItems: Pick[] = items.map((it, idx) => ({
        idx,
        label: it.label || `Ln ${it.line + 1}`,
        description: `Ln ${it.line + 1}`,
        detail:
          capturedEditor.document.lineCount > it.line
            ? capturedEditor.document.lineAt(it.line).text.trim().slice(0, 100)
            : undefined,
        iconPath: iconCache.get(it.groupId),
      }));

      const qp = vscode.window.createQuickPick<Pick>();
      qp.title = 'Bookmarks in File';
      qp.matchOnDescription = true;
      qp.matchOnDetail = true;
      qp.items = qpItems;

      let accepted = false;
      qp.onDidChangeActive((active) => {
        const sel = active[0];
        if (!sel) return;
        if (vscode.window.activeTextEditor !== capturedEditor) return;
        const it = items[sel.idx];
        const range = new vscode.Range(it.line, 0, it.line, 0);
        capturedEditor.selection = new vscode.Selection(range.start, range.end);
        capturedEditor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      });
      qp.onDidAccept(() => {
        accepted = true;
        qp.hide();
      });
      qp.onDidHide(() => {
        if (!accepted) {
          if (
            vscode.window.activeTextEditor === capturedEditor &&
            originalSelection
          ) {
            capturedEditor.selection = originalSelection;
            if (originalVisibleRange) {
              capturedEditor.revealRange(
                originalVisibleRange,
                vscode.TextEditorRevealType.Default,
              );
            }
          }
        }
        qp.dispose();
      });
      qp.show();
    }),

    vscode.commands.registerCommand('agenticBookmarks.listAll', async () => {
      const { folders, filesData } = await loadAllFolders(log, workspaceRoot);
      const foldersByRoot = new Map(folders.map(f => [f.wsRoot, f]));

      const ui = getUIState();
      const visibility = {
        hidden: ui.hidden,
        focus: ui.focus,
        filterEnabled: ui.filterEnabled === true,
        searches: ui.searches,
      };

      const fileFolderById = new Map<string, LoadedFolder>();
      for (const f of filesData) {
        const fileId = (f.data as any).fileId as string;
        const folder = foldersByRoot.get(f.wsRoot);
        if (folder) fileFolderById.set(fileId, folder);
      }
      const composedIsFileHidden = (fileId: string): boolean => {
        const folder = fileFolderById.get(fileId);
        if (!folder) return false;
        if (!isFileHidden(fileId, folder.reg)) return false;
        // Bullseye trumps file-level UI-hide (extends SML-1380's focus-wins
        // precedence to the file boundary). Registry-disable still wins.
        const file = folder.reg.files.find((x: any) => x.fileId === fileId);
        if ((file as any)?.enabled === false) return true;
        return !(visibility.filterEnabled && visibility.focus !== null);
      };

      const items = buildBookmarkPickItems({
        scope: 'all',
        visibility,
        filesData,
        registry: folders[0]?.reg ?? ({ files: [] } as unknown as WorkspaceRegistryV1),
        isFileHidden: composedIsFileHidden,
        resolveLine: makeResolveLine(),
      });

      if (items.length === 0) {
        vscode.window.showInformationMessage('No bookmarks found');
        return;
      }

      const catalog = await getCatalog();
      const iconCache = await buildIconCache(
        items,
        filesData,
        foldersByRoot,
        catalog,
        defaultIconPath,
      );

      const qpItems: Pick[] = items.map((it, idx) => ({
        idx,
        label: it.label || `Ln ${it.line + 1}`,
        description: `${it.relativePath} · Ln ${it.line + 1}`,
        iconPath: iconCache.get(it.groupId),
      }));

      const qp = vscode.window.createQuickPick<Pick>();
      qp.title = 'All Bookmarks';
      qp.matchOnDescription = true;
      qp.items = qpItems;

      qp.onDidAccept(async () => {
        const sel = qp.selectedItems[0];
        if (!sel) {
          qp.hide();
          return;
        }
        const it = items[sel.idx];
        qp.hide();
        try {
          const fileUri = vscode.Uri.file(it.fsPath);
          const doc = await vscode.workspace.openTextDocument(fileUri);
          const editor = await vscode.window.showTextDocument(doc);
          const range = new vscode.Range(it.line, 0, it.line, 0);
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error(`listAll: failed to open ${it.fsPath}: ${msg}`);
          vscode.window.showErrorMessage(`Cannot open: ${msg}`);
        }
      });
      qp.onDidHide(() => qp.dispose());
      qp.show();
    }),
  ];
}
