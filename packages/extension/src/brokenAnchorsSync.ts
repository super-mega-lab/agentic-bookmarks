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
  type WorkspaceRegistryV1,
} from '@agentic-bookmarks/core';
import { getStateForFile } from './anchorState';

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

    await brokenAnchorsCache.writeBrokenAnchorsCache(cacheDir, mergedEntries);
  } catch (err: any) {
    log(`[brokenAnchorsCache] Sync failed: ${err?.message || err}`);
  }
}
