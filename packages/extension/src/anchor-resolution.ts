/**
 * Anchor resolution orchestration.
 *
 * Creates `onFileOpened` and `revalidateOpenDocuments` — the two functions
 * that drive anchor state when documents are opened or refreshed.
 */

import * as vscode from 'vscode';
import { resolveAnchors, refreshSmartAnchorContext } from '@agentic-bookmarks/core';
import type { AnchorResolutionOptions, AnchorResolutionResult } from '@agentic-bookmarks/core';
import {
  initStateForFile,
  clearStateForFile,
  hasStateForFile,
} from './anchorState';
import { registerBookmarkUri } from './brokenAnchorsSync';
import type { Logger } from './logger';
import type { AnchorRepairQueue } from './repairQueue';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnchorResolutionDeps {
  workspaceRoot: string;
  log: Logger;
  getAllBookmarksForUri: (
    uri: string,
    workspaceRoot: string,
  ) => Promise<Array<{ bookmark: { id: string; anchor: any; targetUri: string }; isLocal: boolean }>>;
  /** Get anchor resolution options from registry settings (flex context flags + display settings) */
  getResolutionOptions: () => Promise<AnchorResolutionOptions & {
    showWarningOnShared?: boolean;
    enableLocalContextRefresh?: boolean;
  }>;
  /** Write refreshed anchors back to their bookmarks data files (for local context refresh) */
  writeRefreshedAnchors?: (updates: Array<{ bookmarkId: string; anchor: any }>) => Promise<void>;
  refreshTree: () => void;
  getRepairQueue: () => AnchorRepairQueue | null;
  debouncedCacheSync: () => void;
}

export interface AnchorResolution {
  onFileOpened: (
    document: vscode.TextDocument,
    opts?: { deferTreeRefresh?: boolean },
  ) => Promise<void>;
  revalidateOpenDocuments: () => Promise<void>;
}

/** Bookmark + resolution outcome for one target URI. */
export interface ResolvedUriAnchors {
  allBookmarks: Array<{ bookmark: { id: string; anchor: any; targetUri: string }; isLocal: boolean }>;
  results: AnchorResolutionResult[];
  isLocalMap: Map<string, boolean>;
  showWarningOnShared: boolean;
  enableLocalContextRefresh: boolean;
}

export interface ResolveUriDeps {
  workspaceRoot: string;
  getAllBookmarksForUri: AnchorResolutionDeps['getAllBookmarksForUri'];
  getResolutionOptions: AnchorResolutionDeps['getResolutionOptions'];
}

/**
 * Resolve every bookmark targeting `uri` against the supplied `fileLines`.
 * Single source of truth for "resolve a URI's anchors": used by the open-document
 * path (onFileOpened) and the scan path (validateFile, against disk-read lines).
 * Pure of any open-editor assumptions — the caller supplies the lines.
 */
export async function resolveUriAnchors(
  uri: string,
  fileLines: string[],
  deps: ResolveUriDeps,
): Promise<ResolvedUriAnchors> {
  const allBookmarks = await deps.getAllBookmarksForUri(uri, deps.workspaceRoot);
  const anchorsToResolve = allBookmarks.map(({ bookmark }) => ({ id: bookmark.id, anchor: bookmark.anchor }));
  const resolutionOptions = await deps.getResolutionOptions();
  const { showWarningOnShared, enableLocalContextRefresh, ...coreResolutionOptions } = resolutionOptions;
  const results = resolveAnchors(anchorsToResolve, fileLines, coreResolutionOptions);
  const isLocalMap = new Map<string, boolean>();
  for (const { bookmark, isLocal } of allBookmarks) isLocalMap.set(bookmark.id, isLocal);
  return {
    allBookmarks,
    results,
    isLocalMap,
    showWarningOnShared: showWarningOnShared ?? false,
    enableLocalContextRefresh: enableLocalContextRefresh ?? true,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAnchorResolution(deps: AnchorResolutionDeps): AnchorResolution {
  const {
    workspaceRoot,
    log,
    getAllBookmarksForUri,
    getResolutionOptions,
    refreshTree,
    getRepairQueue,
    debouncedCacheSync,
  } = deps;

  async function onFileOpened(
    document: vscode.TextDocument,
    opts?: { deferTreeRefresh?: boolean },
  ): Promise<void> {
    // Skip non-file documents
    if (document.uri.scheme !== 'file') return;

    const docUri = document.uri.toString();
    log.debug(`[anchorState] onFileOpened: ${docUri}`);

    const fileLines = document.getText().split('\n');

    // Resolve via the shared resolver (single source of truth — see resolveUriAnchors).
    const { allBookmarks, results, isLocalMap, showWarningOnShared, enableLocalContextRefresh } =
      await resolveUriAnchors(docUri, fileLines, { workspaceRoot, getAllBookmarksForUri, getResolutionOptions });
    log.debug(`[anchorState] found ${allBookmarks.length} bookmarks for file`);
    if (allBookmarks.length === 0) {
      clearStateForFile(docUri);
      return;
    }
    log.trace(() => `[anchorState] resolved ${results.length} anchors: ${JSON.stringify(results.map(r => ({ id: r.anchorId, resolved: r.resolved, line: r.line })))}`);

    // Populate in-memory state
    initStateForFile(docUri, results, { isLocalMap, showWarningOnShared });
    log.debug(`[anchorState] state initialized`);

    // Context refresh for local smart anchors — regenerate context when it has drifted
    if ((enableLocalContextRefresh ?? true) && deps.writeRefreshedAnchors) {
      const pendingUpdates: Array<{ bookmarkId: string; anchor: any }> = [];

      for (const result of results) {
        if (!result.resolved || result.line === undefined) continue;
        const entry = allBookmarks.find(b => b.bookmark.id === result.anchorId);
        if (!entry || !entry.isLocal) continue;
        if (entry.bookmark.anchor.kind !== 'smart') continue;

        const { anchor: refreshed, refreshed: didRefresh } = refreshSmartAnchorContext(
          entry.bookmark.anchor,
          result.line,
          fileLines,
          { isLocal: true }
        );

        if (didRefresh) {
          pendingUpdates.push({ bookmarkId: entry.bookmark.id, anchor: refreshed });
          log.debug(`[contextRefresh] Refreshed context for ${entry.bookmark.id}`);
        }
      }

      if (pendingUpdates.length > 0) {
        try {
          await deps.writeRefreshedAnchors(pendingUpdates);
          log.info(`[contextRefresh] Wrote ${pendingUpdates.length} refreshed anchors`);
        } catch (err: any) {
          log.error(`[contextRefresh] Failed to write: ${err?.message || err}`);
        }
      }
    }

    // Register bookmark URIs for broken-anchors cache sync
    for (const { bookmark } of allBookmarks) {
      registerBookmarkUri(docUri, bookmark.id, bookmark.targetUri);
    }

    // Refresh tree view to reflect broken anchor status. The bulk revalidate
    // path defers this and refreshes once after its loop, so the bookmarks tree
    // is rebuilt once per pulse instead of once per open document (SML-1497).
    if (!opts?.deferTreeRefresh) refreshTree();

    // Enqueue broken anchors for background auto-repair (gated by autoRepair setting)
    getRepairQueue()?.enqueue(docUri);

    // Always enqueue for deep-flex position check (NOT gated by autoRepair —
    // updates in-memory display state so bookmarks show at the right line)
    getRepairQueue()?.enqueueDeepFlexOnly(docUri);

    // Sync broken anchors cache to disk
    debouncedCacheSync();
  }

  async function revalidateOpenDocuments(): Promise<void> {
    let revalidatedAny = false;
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme !== 'file') continue;
      if (!hasStateForFile(document.uri.toString())) continue;
      await onFileOpened(document, { deferTreeRefresh: true });
      revalidatedAny = true;
    }
    // Single tree refresh after the bulk re-resolve instead of one per document
    // (SML-1497) — avoids O(N) refreshTree() calls with N open editors.
    if (revalidatedAny) refreshTree();
  }

  return { onFileOpened, revalidateOpenDocuments };
}
