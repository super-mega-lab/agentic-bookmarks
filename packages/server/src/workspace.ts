import {
  readFileAt,
  resolveWorkspacePath,
  toWorkspaceRelativePath,
  readRegistry,
  type WorkspaceRegistryV1,
  type WorkspaceInfo,
  createWorkspaceInfo,
  isWithinWorkspace,
  type BookmarksFileV2,
  ensureLocalDir,
  getLocalDir,
  addFileToRegistry,
  emptyFileV2,
  isLocalPath,
} from '@agentic-bookmarks/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'node:url';

/**
 * Pick the workspace root from initialization rootUris.
 * Falls back to the provided fallbackRoot if no valid file:// URI is found.
 */
export function pickRoot(rootUris?: string[], fallbackRoot: string = process.cwd()): string {
  if (!rootUris || rootUris.length === 0) {
    return fallbackRoot;
  }

  const fileUri = rootUris.find(r => r.startsWith('file://'));
  if (fileUri) {
    return fileURLToPath(fileUri);
  }

  return fallbackRoot;
}

/**
 * Walk upward from a starting directory to find the bookmarks registry.
 *
 * Probes each ancestor for the registry under either the new
 * `.bookmarks/local/` location (preferred) or the legacy `.vscode/`
 * location (kept for unmigrated workspaces; safe to remove once a
 * deprecation cycle has passed). Returns the workspace root if found,
 * otherwise null.
 *
 * The walk tracks `current` independently of how deep the sentinel lives,
 * so the depth change from `.vscode/...` (1) to `.bookmarks/local/...` (2)
 * does not affect what the function returns — it always returns the
 * directory that contains the sentinel directory chain.
 */
export async function findWorkspaceRootUpward(startDir: string): Promise<string | null> {
  const SENTINELS = [
    path.join('.bookmarks', 'local', 'bookmarks.registry.json'),
    path.join('.vscode', 'bookmarks.registry.json'),
  ];
  let current = path.resolve(startDir);
  while (true) {
    for (const sentinel of SENTINELS) {
      try {
        await fs.stat(path.join(current, sentinel));
        return current;
      } catch {}
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Parse workspace configuration from initialization.
 */
export function parseWorkspaceConfig(meta: any): WorkspaceInfo[] {
  // New format: array of workspace configs
  if (meta?.workspaces && Array.isArray(meta.workspaces) && meta.workspaces.length > 0) {
    return meta.workspaces.map((ws: any) => createWorkspaceInfo(
      ws.workspaceRoot,
      {
        registryPath: ws.registryPath,
        bookmarksDataRoot: ws.bookmarksDataRoot,
      }
    ));
  }

  // Environment variable format (from extension)
  if (process.env.MCP_BOOKMARKS_WORKSPACES) {
    try {
      const parsed = JSON.parse(process.env.MCP_BOOKMARKS_WORKSPACES);
      if (Array.isArray(parsed)) {
        return parsed.map((ws: any) => createWorkspaceInfo(
          ws.workspaceRoot,
          {
            registryPath: ws.registryPath,
            bookmarksDataRoot: ws.bookmarksDataRoot,
          }
        ));
      }
    } catch {
      // Invalid JSON, fall through
    }
  }

  // Legacy format: single rootUris
  if (meta?.rootUris) {
    const rootUris = Array.isArray(meta.rootUris) ? meta.rootUris : [meta.rootUris];
    for (const uri of rootUris) {
      if (uri.startsWith('file://')) {
        try {
          const root = fileURLToPath(uri);
          return [createWorkspaceInfo(root)];
        } catch {
          // fallback
        }
      }
    }
  }

  // Fallback: cwd
  const cwd = process.env.BOOKMARKS_DIR || process.cwd();
  return [createWorkspaceInfo(cwd)];
}

/**
 * Merge registry `loadedWorkspaceFolders` into an existing set of workspaces.
 *
 * Preserves the existing WorkspaceInfo for any root already present — keeping the
 * registryPath/bookmarksDataRoot parsed from init meta — and only synthesizes a
 * default WorkspaceInfo for genuinely-new folders. Existing roots keep their order
 * and identity, so the primary workspace (index 0) is unchanged.
 *
 * Roots are matched by their resolved absolute path, so path-equivalent inputs
 * (e.g. a trailing slash) dedup to the existing entry rather than duplicating it.
 *
 * SML-1547: the previous inline merge rebuilt every root via createWorkspaceInfo
 * with no options, silently dropping a non-default bookmarks.dataRoot.
 */
export function mergeLoadedWorkspaceFolders(
  existing: WorkspaceInfo[],
  loadedFolders: string[]
): WorkspaceInfo[] {
  const byRoot = new Map<string, WorkspaceInfo>();
  for (const ws of existing) {
    byRoot.set(path.resolve(ws.workspaceRoot), ws);
  }
  for (const folder of loadedFolders) {
    const resolved = path.resolve(folder);
    if (!byRoot.has(resolved)) {
      byRoot.set(resolved, createWorkspaceInfo(resolved));
    }
  }
  return Array.from(byRoot.values());
}

/**
 * Get the primary workspace (first one, for backward compatibility).
 */
export function getPrimaryWorkspace(workspaces: WorkspaceInfo[]): WorkspaceInfo | null {
  return workspaces[0] ?? null;
}

/**
 * Get workspace for a given URI, preferring the deepest (most specific) match.
 * Returns null if URI is not in any workspace.
 *
 * Uses longest-root-path matching so a file inside a nested workspace (B inside A)
 * resolves to B rather than A, regardless of array order (SML-1575).
 */
export function getWorkspaceForUri(uri: string, workspaces: WorkspaceInfo[]): WorkspaceInfo | null {
  let best: WorkspaceInfo | null = null;
  for (const ws of workspaces) {
    if (
      isWithinWorkspace(uri, ws.workspaceRoot) &&
      (!best || ws.workspaceRoot.length > best.workspaceRoot.length)
    ) {
      best = ws;
    }
  }
  return best;
}

/**
 * Get workspace by root path.
 */
export function getWorkspaceByRoot(root: string, workspaces: WorkspaceInfo[]): WorkspaceInfo | null {
  return workspaces.find(ws => ws.workspaceRoot === root) ?? null;
}

/**
 * Get registry for a workspace.
 */
export async function getRegistryForWorkspace(ws: WorkspaceInfo): Promise<WorkspaceRegistryV1> {
  return readRegistry(ws.workspaceRoot);
}

/**
 * Find which file contains a group by ID.
 */
export async function findFileContainingGroup(
  ws: WorkspaceInfo,
  groupId: string
): Promise<{ fileId: string; filePath: string; registry: WorkspaceRegistryV1 } | null> {
  const registry = await getRegistryForWorkspace(ws);

  for (const fileEntry of registry.files) {
    if (fileEntry.enabled === false) continue;

    try {
      const absolutePath = resolveWorkspacePath(fileEntry.path, ws.workspaceRoot);
      const data = await readFileAt(absolutePath);

      if (data.groups.some(g => g.id === groupId)) {
        return {
          fileId: fileEntry.fileId,
          filePath: absolutePath,
          registry,
        };
      }
    } catch {
      // File not readable, skip
    }
  }

  return null;
}

/**
 * Find group by name in a workspace.
 */
export async function findGroupByName(
  ws: WorkspaceInfo,
  groupName: string
): Promise<{ fileId: string; groupId: string; filePath: string } | null> {
  const registry = await getRegistryForWorkspace(ws);

  const indexEntry = registry.nameIndex[groupName];
  if (indexEntry) {
    const fileEntry = registry.files.find(f => f.fileId === indexEntry.fileId);
    if (fileEntry) {
      const filePath = resolveWorkspacePath(fileEntry.path, ws.workspaceRoot);
      const triple = {
        fileId: indexEntry.fileId,
        groupId: indexEntry.groupId,
        filePath,
      };
      // Verify the group still exists in the file before trusting the index.
      // A stale nameIndex entry (SML-1494) can point at a groupId that was
      // removed from the file; returning it would let bookmark_add write an
      // orphan. Only a CONFIRMED-absent group is treated as stale — if the
      // file is unreadable we keep what we cannot verify and return the triple.
      try {
        const data = await readFileAt(filePath);
        if (data.groups.some(g => g.id === indexEntry.groupId)) {
          return triple;
        }
        return null;
      } catch {
        return triple;
      }
    }
  }

  return null;
}

/**
 * Get the default local bookmark file for a workspace.
 * Creates it if it doesn't exist.
 */
export async function getOrCreateLocalFile(
  ws: WorkspaceInfo
): Promise<{ fileId: string; filePath: string }> {
  const registry = await getRegistryForWorkspace(ws);

  // Look for existing local file
  const localFileEntry = registry.files.find(f =>
    f.enabled !== false && isLocalPath(f.path)
  );

  if (localFileEntry) {
    return {
      fileId: localFileEntry.fileId,
      filePath: resolveWorkspacePath(localFileEntry.path, ws.workspaceRoot),
    };
  }

  // Create new local file
  await ensureLocalDir(ws.workspaceRoot, ws.bookmarksDataRoot);

  const localDir = getLocalDir(ws.workspaceRoot, ws.bookmarksDataRoot);
  const localFilePath = path.join(localDir, 'bookmarks.json');
  const relativeLocalPath = toWorkspaceRelativePath(localFilePath, ws.workspaceRoot)!;

  // Create empty v2 file with isLocal: true (local files have more context for durability)
  const fileId = nanoid(8);
  const newFile: BookmarksFileV2 = {
    version: 2,
    fileId,
    isLocal: true,  // Local file - use expanded context for smart anchors
    groups: [],
    bookmarks: [],
  };

  await fs.mkdir(path.dirname(localFilePath), { recursive: true });
  await fs.writeFile(localFilePath, JSON.stringify(newFile, null, 2));

  // Register in registry
  await addFileToRegistry(ws.workspaceRoot, localFilePath);

  return {
    fileId,
    filePath: localFilePath,
  };
}
