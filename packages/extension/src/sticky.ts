import * as vscode from 'vscode';
import {
  readRegistry,
  getBookmarksDataRoot,
  pathsForDataFile,
  readFileV2 as readFileV2Paths,
  editFileV2,
  workspaceRelativeToUri,
  resolveAnchors,
  updateAnchorForEdit,
  updateAnchorLineCache,
  dispatchByAnchorType,
  type BookmarksFileV2,
} from '@agentic-bookmarks/core';
import {
  getResolvedLine,
  getStatus,
  hasStateForFile,
  applyEditDelta,
} from './anchorState';
import {
  classifyStickyLane,
  isExtremeSmartJump,
  lineWithinTouchedRanges,
  summarizeStickyBatch,
  STICKY_TOUCH_RADIUS,
} from './stickyGuards';
import type { Logger } from './logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StickyDeps {
  workspaceRoot: string;
  log: Logger;
  updateDecorations: () => Promise<void>;
  getLineCacheLength: () => number;
  refreshTree: () => void;
  markEdited: (docUri: string) => void;
}

type StickySkipReason =
  | 'bulk_edit_guard'
  | 'verification_failed'
  | 'empty_linecache_guard'
  | 'unresolved_precondition'
  | 'jump_guard'
  | 'line_not_touched';

// ---------------------------------------------------------------------------
// Smart-anchor verification
// ---------------------------------------------------------------------------

const smartVerifyThreshold = 0.6;

const verifySmartStickyCandidate = (
  bookmarkId: string,
  candidateAnchor: BookmarksFileV2['bookmarks'][number]['anchor'],
  expectedLine: number,
  fileLines: string[]
): boolean => {
  const [resolution] = resolveAnchors([{ id: bookmarkId, anchor: candidateAnchor }], fileLines);
  if (!resolution?.resolved || resolution.line === undefined) return false;
  if (resolution.line !== expectedLine) return false;
  if (typeof resolution.score === 'number' && resolution.score < smartVerifyThreshold) return false;
  return true;
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerStickyHandler(deps: StickyDeps): {
  disposable: vscode.Disposable;
  getLastStickyRefreshAt: () => number;
} {
  const { workspaceRoot, log, updateDecorations, getLineCacheLength, refreshTree, markEdited } = deps;

  const pendingDocs = new Map<string, NodeJS.Timeout>();
  const changeBuffers = new Map<string, vscode.TextDocumentContentChangeEvent[]>();
  let lastStickyRefreshAt = 0;

  const disposable = vscode.workspace.onDidChangeTextDocument((e) => {
    // Ignore non-file documents (e.g., Output channels)
    if (e.document.uri.scheme !== 'file') return;
    const docUri = e.document.uri.toString();
    // Mark file as edited so auto-repair skips it (user is actively editing)
    markEdited(docUri);
    log.debug(`[sticky] onDidChangeTextDocument: ${docUri}, changes=${e.contentChanges.length}`);
    // Accumulate changes for this doc to avoid losing rapid edits within debounce
    const buf = changeBuffers.get(docUri) || [];
    buf.push(...e.contentChanges);
    changeBuffers.set(docUri, buf);
    const prev = pendingDocs.get(docUri);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      pendingDocs.delete(docUri);
      (async () => {
        try {
          // Snapshot and clear buffered changes
          const changes = changeBuffers.get(docUri) || [];
          changeBuffers.set(docUri, []);
          if (changes.length === 0) return;
          log.debug(`[sticky] processing buffered changes: ${changes.length}`);

          const fileLines = e.document.getText().split('\n');
          const lineCacheLen = getLineCacheLength();
          const stickyBatchMetrics = summarizeStickyBatch(changes, fileLines.length);
          const stickyLane = classifyStickyLane(stickyBatchMetrics);
          const blankLinesUseSupport = vscode.workspace.getConfiguration('agenticBookmarks.anchors').get('blankLinesUseSupport', true);

          const skipReasonCounts = new Map<StickySkipReason, number>();
          const consideredRefs = new Set<string>();
          const updatedRefs = new Set<string>();
          const skippedRefs = new Set<string>();
          const skipDedup = new Set<string>();
          const recordSkip = (reason: StickySkipReason, bookmarkRef: string) => {
            skippedRefs.add(bookmarkRef);
            const dedupKey = `${reason}:${bookmarkRef}`;
            if (skipDedup.has(dedupKey)) return;
            skipDedup.add(dedupKey);
            skipReasonCounts.set(reason, (skipReasonCounts.get(reason) ?? 0) + 1);
          };

          const reg = await readRegistry(workspaceRoot);
          const stickyDataRoot = getBookmarksDataRoot(reg);
          const enabled = reg.files.filter(f => f.enabled !== false);
          const targets = await Promise.all(enabled.map(async rf => {
            // Use pathsForDataFile to properly resolve relative paths to absolute
            const p = pathsForDataFile(rf.path, workspaceRoot, stickyDataRoot);
            const f = await readFileV2Paths(p);
            return { p, f } as { p: any; f: BookmarksFileV2 };
          }));
          let anyMutated = false;
          log.debug(`[sticky] Processing ${targets.length} bookmark file(s)`);

          // Helper to compare bookmark URI (possibly workspace-relative) with document URI (file://)
          const docFsPath = vscode.Uri.parse(docUri).fsPath;
          const bookmarkMatchesDoc = (bookmarkUri: string): boolean => {
            const bBase = bookmarkUri.split('#')[0];
            let bFs = '';
            if (bBase.startsWith('file://')) {
              try { bFs = vscode.Uri.parse(bBase).fsPath; } catch { bFs = bBase; }
            } else {
              // Workspace-relative path - resolve to absolute fsPath
              try {
                const absoluteUri = workspaceRelativeToUri(bBase, workspaceRoot);
                bFs = vscode.Uri.parse(absoluteUri).fsPath;
              } catch { bFs = bBase; }
            }
            return bFs === docFsPath;
          };

          for (const target of targets) {
            const file = target.f;
            let mutatedAnchors = false;
            const recomputeIds = new Set<string>();
            let matches = 0;
            for (const b of file.bookmarks) if (bookmarkMatchesDoc(b.target.uri)) matches++;
            if (matches === 0) continue;
            log.debug(`[sticky] File ${target.p.data}: matches=${matches}`);

            for (const change of changes) {
              const start = change.range.start.line;
              const end = change.range.end.line;
              const inserted = change.text.split(/\r?\n/).length - 1;
              const removed = end - start;
              const delta = inserted - removed;
              const touchedByChange = summarizeStickyBatch([change], fileLines.length).touchedRanges;
              log.debug(`[sticky] change: [${start}, ${end}] inserted=${inserted} removed=${removed} delta=${delta}`);

              for (const b of file.bookmarks) {
                if (!bookmarkMatchesDoc(b.target.uri)) continue;
                const bookmarkRef = `${target.p.data}:${b.id}`;
                consideredRefs.add(bookmarkRef);

                try {
                  if (b.anchor.kind === 'smart') {
                    const status = getStatus(docUri, b.id);
                    const resolvedLine = getResolvedLine(docUri, b.id);
                    if (status === 'broken' || resolvedLine === undefined) {
                      recordSkip('unresolved_precondition', bookmarkRef);
                      continue;
                    }

                    if (stickyLane === 'bulk') {
                      recordSkip('bulk_edit_guard', bookmarkRef);
                      continue;
                    }

                    if (!lineWithinTouchedRanges(resolvedLine, touchedByChange, STICKY_TOUCH_RADIUS)) {
                      recordSkip('line_not_touched', bookmarkRef);
                      continue;
                    }

                    const newLineCache = (fileLines[resolvedLine] ?? '').slice(0, lineCacheLen);
                    if (newLineCache === b.anchor.lineCache) {
                      continue;
                    }

                    if (blankLinesUseSupport && newLineCache.trim().length === 0) {
                      recordSkip('empty_linecache_guard', bookmarkRef);
                      continue;
                    }

                    if (isExtremeSmartJump(b.anchor.lastUpdatedLine, resolvedLine) && stickyLane === 'micro') {
                      recordSkip('jump_guard', bookmarkRef);
                      continue;
                    }

                    const candidateAnchor = updateAnchorLineCache(b.anchor, resolvedLine, newLineCache);
                    if (stickyLane === 'medium' && !verifySmartStickyCandidate(b.id, candidateAnchor, resolvedLine, fileLines)) {
                      recordSkip('verification_failed', bookmarkRef);
                      continue;
                    }

                    b.anchor = candidateAnchor;
                    mutatedAnchors = true;
                    updatedRefs.add(bookmarkRef);
                    skippedRefs.delete(bookmarkRef);
                    recomputeIds.add(b.id);
                    continue;
                  }

                  // Use core function for anchor update (handles point/range line shifts)
                  const updatedAnchor = updateAnchorForEdit(
                    b.anchor,
                    start,
                    delta,
                    fileLines,
                    lineCacheLen
                  );

                  // Check if anchor changed using type-safe dispatch
                  const anchorChanged = dispatchByAnchorType(b.anchor, {
                    point: (a) => {
                      const updated = updatedAnchor as typeof a;
                      return a.line !== updated.line || a.lineCache !== updated.lineCache;
                    },
                    range: (a) => {
                      const updated = updatedAnchor as typeof a;
                      return a.start.line !== updated.start.line ||
                             a.end.line !== updated.end.line ||
                             a.lineCache !== updated.lineCache;
                    },
                    smart: (a) => {
                      // Get resolved line from in-memory state
                      const resolvedLine = getResolvedLine(docUri, b.id);
                      if (resolvedLine === undefined) {
                        log.debug(`[sticky] smart anchor ${b.id}: resolvedLine undefined, hasStateForFile=${hasStateForFile(docUri)}`);
                        return false;
                      }

                      // Check if content at resolved line changed
                      const currentContent = (fileLines[resolvedLine] ?? '').slice(0, lineCacheLen);
                      log.debug(`[sticky] smart anchor ${b.id}: resolvedLine=${resolvedLine}, cacheChanged=${a.lineCache !== currentContent}`);
                      return a.lineCache !== currentContent;
                    },
                    tag: () => false,  // No persistent changes during edits
                  });

                  if (anchorChanged) {
                    b.anchor = updatedAnchor;
                    mutatedAnchors = true;
                    updatedRefs.add(bookmarkRef);
                    skippedRefs.delete(bookmarkRef);
                  }

                  recomputeIds.add(b.id);
                } catch (err) {
                  log.error(`[sticky] Error processing bookmark ${b.id}: ${err}`);
                  // Continue processing other bookmarks
                }
              }

              // Update in-memory state for decorations
              applyEditDelta(docUri, start, delta);
            }

            log.debug(`[sticky] affected=${recomputeIds.size}, anchorsChanged=${mutatedAnchors}`);
            if (mutatedAnchors) {
              await editFileV2(target.p, (f) => { f.bookmarks = file.bookmarks; });
              log.debug(`[sticky] wrote updates to disk and pulsed (file ${target.p.data})`);
              anyMutated = true;
            }
          }
          const skipReasons = Object.fromEntries(
            Array.from(skipReasonCounts.entries()).sort(([a], [b]) => a.localeCompare(b))
          );
          log.trace(() => `[sticky] summary ${JSON.stringify({
            lane: stickyLane,
            changes: stickyBatchMetrics.changeCount,
            touchedLines: stickyBatchMetrics.touchedLines,
            fileLines: stickyBatchMetrics.fileLineCount,
            touchedRatio: Number(stickyBatchMetrics.touchedRatio.toFixed(3)),
            considered: consideredRefs.size,
            updated: updatedRefs.size,
            skipped: skippedRefs.size,
            skipReasons,
          })}`);
          if (anyMutated) { refreshTree(); await updateDecorations(); lastStickyRefreshAt = Date.now(); }
        } catch (err) {
          log.error(`Sticky update failed: ${err}`);
        }
      })();
    }, 150);
    pendingDocs.set(docUri, t);
  });

  return {
    disposable,
    getLastStickyRefreshAt: () => lastStickyRefreshAt,
  };
}
