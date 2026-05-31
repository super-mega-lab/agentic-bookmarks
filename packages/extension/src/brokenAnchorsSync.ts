/**
 * Syncs in-memory anchor state to the broken-anchors cache file.
 *
 * Called after initStateForFile(), clearStateForFile(), and auto-repair
 * to keep the cache in sync with what the user sees.
 */

import {
  brokenAnchorsCache,
  getCacheDir,
  getBookmarksDataRoot,
  pathsForDataFile,
  readFileV2,
  type WorkspaceRegistryV1,
} from '@agentic-bookmarks/core';
import { getStateForFile } from './anchorState';
import { mergeCoveredUris, pruneCoveredUris } from './scanValidate';

type BrokenAnchorEntry = brokenAnchorsCache.BrokenAnchorEntry;

// Track which docUris map to which workspace-relative target URIs
const docUriToRelativePaths = new Map<string, Map<string, string>>();

/**
 * Register the workspace-relative URI for a bookmark in a document.
 */
export function registerBookmarkUri(
  docUri: string,
  bookmarkId: string,
  workspaceRelativeUri: string,
): void {
  let map = docUriToRelativePaths.get(docUri);
  if (!map) {
    map = new Map();
    docUriToRelativePaths.set(docUri, map);
  }
  map.set(bookmarkId, workspaceRelativeUri);
}

/**
 * Clear registered URIs when a file closes.
 */
export function clearRegisteredUris(docUri: string): void {
  docUriToRelativePaths.delete(docUri);
}

/** Core readers collectBookmarkedUris depends on — injected for testability, defaulting to core. */
export interface BookmarkedUrisReaders {
  getBookmarksDataRoot: typeof getBookmarksDataRoot;
  pathsForDataFile: typeof pathsForDataFile;
  readFileV2: typeof readFileV2;
}

/**
 * Build the live "universe" of bookmarked workspace-relative target URIs (fragment-stripped) —
 * the same set the MCP server computes as `index.universe`. Used to prune coveredUris so the
 * persisted cache can't grow without bound (SML-1509).
 *
 * `reliable` is false when any enabled data file fails to read; callers skip pruning in that
 * case rather than drop coverage for a file whose data is momentarily unreadable (this mirrors
 * the server's `loadError` conservatism in anchor-git.ts).
 */
export async function collectBookmarkedUris(
  workspaceRoot: string,
  registry: WorkspaceRegistryV1,
  readers: BookmarkedUrisReaders = { getBookmarksDataRoot, pathsForDataFile, readFileV2 },
): Promise<{ uris: Set<string>; reliable: boolean }> {
  const dataRoot = readers.getBookmarksDataRoot(registry);
  const uris = new Set<string>();
  let reliable = true;
  for (const rf of registry.files.filter((f) => f.enabled !== false)) {
    try {
      const file = await readers.readFileV2(readers.pathsForDataFile(rf.path, workspaceRoot, dataRoot));
      for (const b of file.bookmarks) uris.add(b.target.uri.split('#')[0]);
    } catch {
      reliable = false;
    }
  }
  return { uris, reliable };
}

/**
 * Sync current anchor state to the broken-anchors cache file.
 */
export async function syncBrokenAnchorsCache(
  workspaceRoot: string,
  registryOrNull: WorkspaceRegistryV1 | null,
  log: (msg: string) => void,
): Promise<void> {
  try {
    const dataRoot = getBookmarksDataRoot(registryOrNull);
    const cacheDir = getCacheDir(workspaceRoot, dataRoot);

    // Read existing cache to preserve discoveredAt timestamps and entries from unopened files
    const existing = await brokenAnchorsCache.readBrokenAnchorsCache(cacheDir);
    const existingMap = new Map<string, BrokenAnchorEntry>();
    for (const entry of existing.entries) {
      existingMap.set(entry.bookmarkId, entry);
    }

    // Collect current broken/warning entries from all tracked files
    const currentEntries = new Map<string, BrokenAnchorEntry>();

    for (const [docUri, uriMap] of docUriToRelativePaths) {
      const fileState = getStateForFile(docUri);
      if (!fileState) continue;

      for (const [bookmarkId, state] of fileState) {
        if (state.status === 'broken' || state.status === 'warning') {
          const relativeUri = uriMap.get(bookmarkId);
          if (!relativeUri) continue;

          const existingEntry = existingMap.get(bookmarkId);
          const discoveredAt = existingEntry?.discoveredAt ?? Date.now();

          currentEntries.set(bookmarkId, {
            bookmarkId,
            uri: relativeUri,
            status: state.status,
            errorCode: state.errorCode ?? null,
            errorDetails: state.errorDetails ?? null,
            score: state.score ?? null,
            discoveredAt,
          });
        }
      }
    }

    // Merge: keep existing entries for files NOT currently open
    const openBookmarkIds = new Set<string>();
    for (const [, uriMap] of docUriToRelativePaths) {
      for (const bookmarkId of uriMap.keys()) {
        openBookmarkIds.add(bookmarkId);
      }
    }

    const mergedEntries: BrokenAnchorEntry[] = [];
    for (const entry of existing.entries) {
      if (!openBookmarkIds.has(entry.bookmarkId)) {
        mergedEntries.push(entry);
      }
    }
    for (const entry of currentEntries.values()) {
      mergedEntries.push(entry);
    }

    // Accumulate coverage: every currently-open file's workspace-relative URI is
    // a file we just validated, unioned onto whatever the cache already covered.
    const openRelUris: string[] = [];
    for (const [, uriMap] of docUriToRelativePaths) {
      for (const relUri of uriMap.values()) openRelUris.push(relUri);
    }
    let coveredUris = mergeCoveredUris(existing.coveredUris ?? [], openRelUris);
    // Prune coverage for files no longer bookmarked (deleted/deregistered/un-bookmarked) so the
    // set stays bounded (SML-1509). Skip when the universe read is unreliable — a data file
    // failed to load — to avoid dropping coverage for a momentarily-unreadable file.
    if (registryOrNull) {
      const { uris, reliable } = await collectBookmarkedUris(workspaceRoot, registryOrNull);
      if (reliable) coveredUris = pruneCoveredUris(coveredUris, uris);
    }

    await brokenAnchorsCache.writeBrokenAnchorsCache(cacheDir, mergedEntries, coveredUris);
  } catch (err: any) {
    log(`[brokenAnchorsCache] Sync failed: ${err?.message || err}`);
  }
}
