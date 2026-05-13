// ABOUTME: Shared multi-root loaders used by list quick-picks and the export command —
// ABOUTME: walks every workspace folder's registry + per-file BookmarksFileV2 data.

import * as vscode from 'vscode';
import {
  pathsForDataFile,
  readFileV2,
  readRegistry,
  getBookmarksDataRoot,
  type BookmarksFileV2,
  type WorkspaceRegistryV1,
} from '@agentic-bookmarks/core';
import { getResolvedLine } from '../anchorState';
import type { Logger } from '../logger';
import type { BuildBookmarkPickItemsOpts } from './bookmark-quickpick-items';

export type LoadedFile = {
  wsRoot: string;
  dataRoot: string;
  regPath: string;
  data: BookmarksFileV2;
};

export type LoadedFolder = {
  wsRoot: string;
  reg: WorkspaceRegistryV1;
  dataRoot: string;
};

/**
 * Read the registry and BookmarksFileV2 for every workspace folder, matching
 * how `BookmarksProvider.getChildren` traverses multi-root workspaces.
 * Visibility (group/file hiding) and search filters are applied downstream in
 * `buildBookmarkPickItems`. Files that fail to read are skipped — same
 * tolerance as the tree provider.
 */
export async function loadAllFolders(
  log: Logger,
  fallbackRoot: string,
): Promise<{ folders: LoadedFolder[]; filesData: LoadedFile[] }> {
  const wsFolders = vscode.workspace.workspaceFolders ?? [];
  const roots = wsFolders.length > 0 ? wsFolders.map(f => f.uri.fsPath) : [fallbackRoot];

  const folders: LoadedFolder[] = [];
  const filesData: LoadedFile[] = [];
  for (const wsRoot of roots) {
    let reg: WorkspaceRegistryV1;
    try {
      reg = await readRegistry(wsRoot);
    } catch (err) {
      log.error(
        `bookmark-loaders: failed to read registry for ${wsRoot}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }
    const dataRoot = getBookmarksDataRoot(reg);
    folders.push({ wsRoot, reg, dataRoot });
    for (const rf of reg.files) {
      const p = pathsForDataFile(rf.path, wsRoot, dataRoot);
      try {
        const data = await readFileV2(p);
        filesData.push({ wsRoot, dataRoot, regPath: rf.path, data });
      } catch {
        // Skip unreadable files — matches treeProvider's tolerance.
      }
    }
  }
  return { folders, filesData };
}

/**
 * Canonicalize the bookmarked file's fs path to the URI form VS Code uses for
 * `editor.document.uri.toString()`, then look up `anchorState`'s resolved line.
 */
export function makeResolveLine(): BuildBookmarkPickItemsOpts['resolveLine'] {
  return (bookmarkId, fsPath, fallback) => {
    const docUri = vscode.Uri.file(fsPath).toString();
    const r = getResolvedLine(docUri, bookmarkId);
    return r ?? fallback;
  };
}
