/**
 * Workspace helpers and top-level utilities extracted from extension.ts.
 * These functions are standalone — they don't use closure state from activate().
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import {
  readRegistry,
  writeRegistry,
  setLoadedWorkspaceFolders,
  createWorkspaceInfo,
  DEFAULT_BOOKMARKS_DATA_ROOT,
  comments,
  pathsForDataFile,
  readFileV2 as readFileV2Paths,
  getBookmarksDataRoot,
  workspaceRelativeToUri,
  getOrCreateUnsortedGroup,
  addFileToRegistry,
  discoverSharedBookmarkFiles,
  getDefaultLocalFilePath,
  ensureLocalDir,
  registryPathForRoot,
  getRegistryPath,
  initializeRegistry,
  isLocalPath,
  resolveIsLocal,
  emptyFileV2,
  type WorkspaceInfo,
  type BookmarksFileV2,
} from '@agentic-bookmarks/core';
import type { Logger } from './logger';

/**
 * Sync the bookmarks.dataRoot setting to the registry.
 * This allows the MCP server to read the configured data root.
 */
export async function syncDataRootSetting(workspaceRoot: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('agenticBookmarks', vscode.Uri.file(workspaceRoot));
  const dataRoot = config.get<string>('dataRoot', DEFAULT_BOOKMARKS_DATA_ROOT);

  try {
    const registry = await readRegistry(workspaceRoot);

    // Initialize paths settings if missing
    if (!registry.settings.paths) {
      (registry.settings as any).paths = {};
    }

    // Only store if different from default
    const currentRoot = registry.settings.paths?.bookmarksDataRoot;
    const shouldStore = dataRoot !== DEFAULT_BOOKMARKS_DATA_ROOT;

    if (shouldStore !== !!currentRoot || (shouldStore && currentRoot !== dataRoot)) {
      (registry.settings.paths as any).bookmarksDataRoot = shouldStore ? dataRoot : undefined;
      await writeRegistry(workspaceRoot, registry);
    }
  } catch (error) {
    // Registry doesn't exist yet - will be created with correct settings later
    console.log(`Registry not found for ${workspaceRoot}, skipping settings sync`);
  }
}

/** Build the agent repair prompt for a broken bookmark (single source of truth). */
export function buildAgentRepairPrompt(bookmarkId: string): string {
  return `please use the MCP anchor_getRepairSkillGuide and repair the bookmark ${bookmarkId}`;
}

/**
 * Get the configured data root for a workspace folder.
 */
export function getConfiguredDataRoot(workspaceFolder: vscode.WorkspaceFolder): string {
  const config = vscode.workspace.getConfiguration('agenticBookmarks', workspaceFolder.uri);
  return config.get<string>('dataRoot', DEFAULT_BOOKMARKS_DATA_ROOT);
}

/**
 * Persist the current list of workspace folder roots into each registry
 * (absolute paths, deduped). This helps MCP server discovery for multi-root.
 */
export async function syncLoadedWorkspaceFoldersAcrossRegistries(): Promise<void> {
  const folders = (vscode.workspace.workspaceFolders || []).map(f => path.resolve(f.uri.fsPath));
  const unique = Array.from(new Set(folders));
  for (const root of unique) {
    try {
      await setLoadedWorkspaceFolders(root, unique);
    } catch {
      // Best effort; skip if registry not accessible yet
    }
  }
}

/**
 * Build workspace configuration array for MCP server initialization.
 */
export function getMcpWorkspaceConfig(): WorkspaceInfo[] {
  const folders = vscode.workspace.workspaceFolders || [];

  return folders.map(folder => {
    const workspaceRoot = folder.uri.fsPath;
    const dataRoot = getConfiguredDataRoot(folder);

    return createWorkspaceInfo(workspaceRoot, {
      bookmarksDataRoot: dataRoot,
    });
  });
}

/**
 * Check if two file paths are in the same workspace.
 */
export function areInSameWorkspace(path1: string, path2: string): boolean {
  const ws1 = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(path1));
  const ws2 = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(path2));

  if (!ws1 || !ws2) return false;
  return ws1.uri.fsPath === ws2.uri.fsPath;
}

/**
 * Get workspace root for a file path.
 */
export function getWorkspaceRootForPath(filePath: string): string | null {
  const wsFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
  return wsFolder?.uri.fsPath ?? null;
}

/**
 * Get the workspace folder for a group node.
 */
export function getWorkspaceForGroupNode(node: any): vscode.WorkspaceFolder | null {
  // Use workspaceRoot property if available (stored on the node)
  if (node.workspaceRoot) {
    return vscode.workspace.workspaceFolders?.find(f => f.uri.fsPath === node.workspaceRoot) ?? null;
  }

  // Last resort: use first workspace
  return vscode.workspace.workspaceFolders?.[0] ?? null;
}

/**
 * Get the workspace folder for a bookmark node.
 */
export function getWorkspaceForBookmarkNode(node: any): vscode.WorkspaceFolder | null {
  // Use workspaceRoot property if available (stored on the node)
  if (node.workspaceRoot) {
    return vscode.workspace.workspaceFolders?.find(f => f.uri.fsPath === node.workspaceRoot) ?? null;
  }

  // Last resort: use first workspace
  return vscode.workspace.workspaceFolders?.[0] ?? null;
}

/**
 * Check if a directory exists.
 */
export async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists.
 */
export async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Insert a bookmark tag comment at the specified line.
 * Uses the CommentHelper to determine the appropriate comment marker.
 * Supports both 'inline' (append to end of line) and 'above' (insert on line above) placement.
 *
 * @param editor - The VS Code text editor
 * @param line - The line number (0-based)
 * @param tagId - The bookmark tag ID
 * @param placement - Where to place the tag: 'inline' (default) or 'above'
 * @returns True if the tag was successfully inserted
 */
export async function insertTagComment(
  editor: vscode.TextEditor,
  line: number,
  tagId: string,
  placement: 'inline' | 'above' = 'inline'
): Promise<boolean> {
  const document = editor.document;
  const currentLine = document.lineAt(line).text;
  const languageId = document.languageId;

  // Use CommentHelper to get appropriate comment marker
  const helper = comments.createCommentHelper();
  const tagText = `@bookmark:${tagId}`;

  // MVP: 'above' placement disabled - causes visual bugs where gutter shows on wrong line
  // if (placement === 'above') {
  //   // Insert tag comment on line above
  //   const edit = new vscode.WorkspaceEdit();
  //   const position = new vscode.Position(line, 0);
  //
  //   // Get comment marker for this language
  //   const markerResult = helper.appendComment('', tagText, languageId);
  //   let commentLine: string;
  //   if (markerResult.success && markerResult.line) {
  //     commentLine = markerResult.line;
  //   } else {
  //     // Fall back to // for unsupported languages
  //     commentLine = `// ${tagText}`;
  //   }
  //
  //   // Match indentation of the target line
  //   const indentMatch = currentLine.match(/^(\s*)/);
  //   const indent = indentMatch ? indentMatch[1] : '';
  //   edit.insert(document.uri, position, `${indent}${commentLine.trimStart()}\n`);
  //   return vscode.workspace.applyEdit(edit);
  // }

  // Default: inline placement (append to end of line)
  const result = helper.appendComment(currentLine, tagText, languageId);

  if (!result.success || !result.line) {
    // Fall back to // if language not supported
    const trimmedLine = currentLine.trimEnd();
    const spacing = trimmedLine.length > 0 ? '  ' : '';
    const fallbackLine = `${trimmedLine}${spacing}// ${tagText}`;

    const edit = new vscode.WorkspaceEdit();
    const lineRange = document.lineAt(line).range;
    edit.replace(document.uri, lineRange, fallbackLine);
    return vscode.workspace.applyEdit(edit);
  }

  const edit = new vscode.WorkspaceEdit();
  const lineRange = document.lineAt(line).range;
  edit.replace(document.uri, lineRange, result.line);
  return vscode.workspace.applyEdit(edit);
}

/**
 * Remove a bookmark tag comment from the specified line.
 * Removes `@bookmark:<tagId>` and any surrounding comment markers if the line becomes empty.
 *
 * @param document - The VS Code text document
 * @param line - The line number (0-based)
 * @param tagId - The bookmark tag ID to remove
 * @returns True if the tag was successfully removed
 */
export async function removeTagComment(
  document: vscode.TextDocument,
  line: number,
  tagId: string
): Promise<boolean> {
  if (line < 0 || line >= document.lineCount) {
    return false;
  }

  const currentLine = document.lineAt(line).text;
  const escapedTagId = tagId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const TAG_TAIL = '(?![A-Za-z0-9_-])';
  const tagPattern = new RegExp(`\\s*//\\s*@bookmark:${escapedTagId}${TAG_TAIL}|\\s*#\\s*@bookmark:${escapedTagId}${TAG_TAIL}|\\s*/\\*\\s*@bookmark:${escapedTagId}\\s*\\*/`, 'g');

  const newLine = currentLine.replace(tagPattern, '');

  if (newLine === currentLine) {
    // Tag not found on this line
    return false;
  }

  const edit = new vscode.WorkspaceEdit();
  const lineRange = document.lineAt(line).range;
  edit.replace(document.uri, lineRange, newLine);
  return vscode.workspace.applyEdit(edit);
}

/**
 * Normalize bookmark URIs to support relative paths like "src/file.ts:100".
 *
 * @param raw - The raw URI string to parse
 * @param workspaceRoot - The workspace root path for resolving relative paths
 */
export function parseBookmarkUri(raw: string, workspaceRoot: string): { file: vscode.Uri | null; line?: number } {
  try {
    // Extract line from either #L123 or :123 suffix
    let line: number | undefined;
    const hashMatch = raw.match(/#L?(\d+)/);
    if (hashMatch) {
      line = parseInt(hashMatch[1], 10);
    } else {
      const colonMatch = raw.match(/:(\d+)$/);
      // Avoid treating Windows drive letters like C:\ as line suffix
      if (colonMatch && !/^\w:\\/.test(raw)) {
        line = parseInt(colonMatch[1], 10);
        raw = raw.slice(0, raw.length - colonMatch[0].length);
      }
    }

    if (raw.startsWith('file://')) {
      const uri = vscode.Uri.parse(raw).with({ fragment: '' });
      return { file: uri, line };
    }

    // Treat as path (absolute or relative to workspace)
    const abs = path.isAbsolute(raw) ? raw : path.join(workspaceRoot, raw);
    const uri = vscode.Uri.file(abs);
    return { file: uri, line };
  } catch {
    return { file: null };
  }
}

/**
 * Resolve a 0-based line from various command arg shapes or fallback to cursor.
 */
export function resolveLineFromArg(arg: any, editor: vscode.TextEditor): number {
  if (typeof arg === 'number' && isFinite(arg)) return Math.max(0, Math.floor(arg) - 1);
  if (arg && typeof arg === 'object' && typeof arg.lineNumber === 'number') return Math.max(0, Math.floor(arg.lineNumber) - 1);
  return editor.selection.active.line;
}

/**
 * Get the last known line for an anchor (used for repair lookups).
 */
export function getLastKnownLineForAnchor(anchor: BookmarksFileV2['bookmarks'][number]['anchor']): number {
  if (anchor.kind === 'point') return anchor.line;
  if (anchor.kind === 'range') return anchor.start.line;
  return anchor.lastUpdatedLine;
}

/**
 * Get lines from an already-open document by URI string.
 */
export function getOpenDocumentLines(docUri: string): string[] | null {
  const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === docUri);
  if (!doc) return null;
  return doc.getText().split('\n');
}

/**
 * Get file lines for a document URI, using open document if available, otherwise reading from disk.
 */
export async function getFileLinesForDocUri(docUri: string): Promise<string[] | null> {
  const openDocLines = getOpenDocumentLines(docUri);
  if (openDocLines) return openDocLines;
  try {
    const fsPath = vscode.Uri.parse(docUri).fsPath;
    const content = await fsp.readFile(fsPath, 'utf-8');
    return content.split('\n');
  } catch {
    return null;
  }
}

/**
 * Get bookmarks targeting a specific URI across all enabled registered files.
 */
export async function getBookmarksForUri(uri: string, workspaceRoot: string): Promise<any[]> {
  const bookmarks: any[] = [];
  try {
    const reg = await readRegistry(workspaceRoot);
    const dataRoot = getBookmarksDataRoot(reg);
    const enabledFiles = reg.files.filter(f => f.enabled !== false);

    // Convert input URI to fsPath for comparison
    const uriFsPath = vscode.Uri.parse(uri).fsPath;

    for (const rf of enabledFiles) {
      try {
        // Use pathsForDataFile to properly resolve relative paths to absolute
        const filePaths = pathsForDataFile(rf.path, workspaceRoot, dataRoot);
        const file = await readFileV2Paths(filePaths);
        for (const bookmark of file.bookmarks) {
          const bookmarkUri = bookmark.target.uri.split('#')[0];
          // Handle both absolute file:// URIs and workspace-relative paths
          let bookmarkFsPath = '';
          if (bookmarkUri.startsWith('file://')) {
            try { bookmarkFsPath = vscode.Uri.parse(bookmarkUri).fsPath; } catch { bookmarkFsPath = bookmarkUri; }
          } else {
            try {
              const absoluteUri = workspaceRelativeToUri(bookmarkUri, workspaceRoot);
              bookmarkFsPath = vscode.Uri.parse(absoluteUri).fsPath;
            } catch { bookmarkFsPath = bookmarkUri; }
          }
          if (bookmarkFsPath === uriFsPath) {
            bookmarks.push(bookmark);
          }
        }
      } catch (err) {
        console.error(`[getBookmarksForUri] Error reading bookmark file ${rf.path}:`, err);
      }
    }
  } catch (err) {
    console.error(`[getBookmarksForUri] Error reading registry for workspace ${workspaceRoot}:`, err);
  }
  return bookmarks;
}

/**
 * Get all bookmarks with anchors for a URI (for anchor resolution).
 */
export async function getAllBookmarksForUri(uri: string, workspaceRoot: string): Promise<Array<{ bookmark: { id: string; anchor: any; targetUri: string }; isLocal: boolean }>> {
  const results: Array<{ bookmark: { id: string; anchor: any; targetUri: string }; isLocal: boolean }> = [];
  try {
    const reg = await readRegistry(workspaceRoot);
    const dataRoot = getBookmarksDataRoot(reg);
    const enabledFiles = reg.files.filter(f => f.enabled !== false);

    // Convert input URI to fsPath for comparison
    const uriFsPath = vscode.Uri.parse(uri).fsPath;

    for (const rf of enabledFiles) {
      try {
        const filePaths = pathsForDataFile(rf.path, workspaceRoot, dataRoot);
        const file = await readFileV2Paths(filePaths);
        const fileIsLocal = resolveIsLocal(file, filePaths.data, workspaceRoot);
        for (const bookmark of file.bookmarks) {
          const bookmarkUri = bookmark.target.uri.split('#')[0];
          let bookmarkFsPath = '';
          if (bookmarkUri.startsWith('file://')) {
            try { bookmarkFsPath = vscode.Uri.parse(bookmarkUri).fsPath; } catch { bookmarkFsPath = bookmarkUri; }
          } else {
            try {
              const absoluteUri = workspaceRelativeToUri(bookmarkUri, workspaceRoot);
              bookmarkFsPath = vscode.Uri.parse(absoluteUri).fsPath;
            } catch { bookmarkFsPath = bookmarkUri; }
          }
          if (bookmarkFsPath === uriFsPath) {
            results.push({ bookmark: { id: bookmark.id, anchor: bookmark.anchor, targetUri: bookmarkUri }, isLocal: fileIsLocal });
          }
        }
      } catch (err) {
        console.error(`[getAllBookmarksForUri] Error reading bookmark file ${rf.path}:`, err);
      }
    }
  } catch (err) {
    console.error(`[getAllBookmarksForUri] Error reading registry for workspace ${workspaceRoot}:`, err);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Default-target resolution
// ---------------------------------------------------------------------------

/** Return type for getDefaultTargetForWorkspace. */
export type DefaultTarget = {
  paths: { dir: string; data: string; bak: string; lock: string; pulse: string };
  groupId: string;
};

/**
 * Resolve the default target file + group from the workspace registry.
 *
 * Falls back to `.bookmarks/local/bookmarks.json` (with auto-creation and
 * registry registration) when no explicit default is configured.
 */
export async function getDefaultTargetForWorkspace(
  targetWorkspaceRoot: string,
  targetWorkspaceFolder: vscode.WorkspaceFolder,
  log: Logger,
): Promise<DefaultTarget> {
  const reg = await readRegistry(targetWorkspaceRoot);
  const dataRoot = getConfiguredDataRoot(targetWorkspaceFolder);
  const def = reg.defaultTarget;
  if (def) {
    const rf = reg.files.find(f => (f as any).fileId === (def as any).fileId);
    if (rf && rf.enabled !== false) {
      const p = pathsForDataFile(rf.path, targetWorkspaceRoot, dataRoot);
      return {
        paths: { dir: p.dir, data: p.data, bak: p.bak, lock: p.lock, pulse: p.pulse },
        groupId: (def as any).groupId as string,
      };
    }
  }
  // Fallback to new default location: .bookmarks/local/bookmarks.json
  const fallbackPath = getDefaultLocalFilePath(targetWorkspaceRoot, dataRoot);
  const fallbackPaths = pathsForDataFile(fallbackPath, targetWorkspaceRoot, dataRoot);
  await ensureLocalDir(targetWorkspaceRoot, dataRoot);

  // Read or create the bookmark file
  const file = await readFileV2Paths(fallbackPaths);
  const groupId = getOrCreateUnsortedGroup(file);

  // Register this file in the workspace's registry so it appears in tree views
  log.debug(`[getDefaultTargetForWorkspace] Registering fallback file: ${fallbackPath} in workspace: ${targetWorkspaceRoot}`);
  const updatedReg = await addFileToRegistry(targetWorkspaceRoot, fallbackPath);

  // Set as default target if not already set
  if (!updatedReg.defaultTarget) {
    const registeredFile = updatedReg.files.find(f => {
      const absPath = path.isAbsolute(f.path) ? f.path : path.join(targetWorkspaceRoot, f.path);
      return path.resolve(absPath) === path.resolve(fallbackPaths.data);
    });
    if (registeredFile) {
      log.debug(`[getDefaultTargetForWorkspace] Setting default target: fileId=${(registeredFile as any).fileId}, groupId=${groupId}`);
      (updatedReg as any).defaultTarget = { fileId: (registeredFile as any).fileId, groupId };
      await writeRegistry(targetWorkspaceRoot, updatedReg);
    }
  }

  return { paths: fallbackPaths, groupId: groupId as any };
}

// ---------------------------------------------------------------------------
// Style catalog: now loaded from the extension's bundled `media/styles/`.
// The workspace-level copy this used to maintain has been retired
// (SML-1320). Pro-mode would re-introduce a catalog source switch in
// `getBuiltinCatalog` — see `catalog-cache.ts`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Workspace bootstrap (runs once per activation)
// ---------------------------------------------------------------------------

export interface BootstrapDeps {
  context: vscode.ExtensionContext;
  log: Logger;
  workspaceRoot: string;
  defaultDataRoot: string;
  paths: { dir: string; data: string; bak: string; lock: string; pulse: string };
}

/**
 * One-time workspace initialization that runs during activate():
 *  1. Sync data-root setting to registries
 *  2. Auto-init registries where `.bookmarks/` exists without a registry
 *  3. Ensure default v2 data file exists and is registered
 *  4. Persist loaded workspace folders to registries
 *  5. Install style catalogs for every workspace folder
 */
export async function bootstrapWorkspaces(deps: BootstrapDeps): Promise<void> {
  const { context, log, workspaceRoot, defaultDataRoot, paths } = deps;

  // 1. Sync data root setting to registry for all workspace folders
  for (const folder of vscode.workspace.workspaceFolders || []) {
    await syncDataRootSetting(folder.uri.fsPath);
  }

  // 2. Auto-initialize registry if .bookmarks/ exists but registry doesn't
  for (const folder of vscode.workspace.workspaceFolders || []) {
    const wsRoot = folder.uri.fsPath;
    const dataRoot = getConfiguredDataRoot(folder);
    const bookmarksDir = path.join(wsRoot, dataRoot);
    const registryPath = getRegistryPath(wsRoot, dataRoot);

    const hasBookmarksDir = await dirExists(bookmarksDir);
    const hasRegistry = await fileExists(registryPath);

    if (hasBookmarksDir && !hasRegistry) {
      log.info(`Initializing registry for ${wsRoot} (found existing ${dataRoot}/ directory)`);
      await initializeRegistry(wsRoot, { bookmarksDataRoot: dataRoot });
    }
  }

  // 3. Ensure the default v2 data file exists and is registered
  try {
    try { await fsp.access(paths.data); }
    catch {
      const bookmarksFileRelativePath = path.relative(workspaceRoot, paths.data);
      const local = isLocalPath(bookmarksFileRelativePath);
      const empty = emptyFileV2({ isLocal: local });
      await fsp.mkdir(path.dirname(paths.data), { recursive: true });
      await fsp.writeFile(paths.data, JSON.stringify(empty, null, 2), 'utf8');
    }
    const reg = await readRegistry(workspaceRoot);
    const hasDefault = reg.files.some(f => path.resolve(f.path) === path.resolve(paths.data));
    if (!hasDefault) {
      await addFileToRegistry(workspaceRoot, paths.data);
    }
  } catch (e) {
    log.error(`Failed to ensure default data/registry: ${e}`);
  }

  // 3.5. Discover shared bookmark files newly arrived on disk (e.g., pulled
  // from git by other users) and register them in the local registry.
  // `initializeRegistry` only scans on first-time creation, so without this
  // step, subsequent activations would miss shared files added later.
  for (const folder of vscode.workspace.workspaceFolders || []) {
    try {
      const dataRoot = getConfiguredDataRoot(folder);
      const result = await discoverSharedBookmarkFiles(folder.uri.fsPath, { bookmarksDataRoot: dataRoot });
      if (result.added.length > 0) {
        log.info(`Discovered ${result.added.length} shared bookmark file(s) at ${folder.uri.fsPath}: ${result.added.map(a => a.path).join(', ')}`);
      }
    } catch (e) {
      log.error(`Failed to discover shared bookmark files for ${folder.uri.fsPath}: ${e}`);
    }
  }

  // 4. Persist the current workspace folder list into registries
  try {
    await syncLoadedWorkspaceFoldersAcrossRegistries();
  } catch (err) {
    console.error(`[activate] Error syncing workspace folders to registries:`, err);
    log.error(`[activate] ERROR: Failed to sync workspace folders: ${err}`);
  }

  // (Step 5 — workspace style-catalog install — removed in SML-1320.
  // Catalog now loads from the extension's bundled media/styles/ via
  // getBuiltinCatalog(context); no per-workspace replication needed.)
}
