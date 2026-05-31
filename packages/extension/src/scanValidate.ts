// ABOUTME: Pure scan-validation helpers — mint file_missing entries and build the
// ABOUTME: authoritative cache. Status classification is shared via anchorState.
import type { brokenAnchorsCache } from '@agentic-bookmarks/core';
import type { AnchorStatus } from './anchorState';

type BrokenAnchorEntry = brokenAnchorsCache.BrokenAnchorEntry;

export type ScanStatus = AnchorStatus;

/** Error code for a bookmark whose target file no longer exists on disk. */
export const FILE_MISSING_CODE = 'file_missing';

/** One bookmark's scan outcome (before it becomes a cache entry). */
export interface ScanResultEntry {
  bookmarkId: string;
  /** Workspace-relative target URI. */
  uri: string;
  status: ScanStatus;
  errorCode: string | null;
  errorDetails: string | null;
  score: number | null;
}

/** Merge persisted covered-file URIs with newly-checked ones, de-duplicated. */
export function mergeCoveredUris(existing: string[], added: Iterable<string>): string[] {
  return [...new Set([...existing, ...added])];
}

/**
 * Drop covered-file URIs no longer in the live bookmark `universe` — files that were
 * deleted, deregistered, or stripped of their last bookmark — so the persisted set
 * can't grow without bound (SML-1509). Membership is fragment-insensitive, matching
 * the normalization the server applies when intersecting coverage with `index.universe`.
 */
export function pruneCoveredUris(coveredUris: string[], universe: Iterable<string>): string[] {
  const live = new Set<string>();
  for (const u of universe) live.add(u.split('#')[0]);
  return coveredUris.filter((u) => live.has(u.split('#')[0]));
}

/** Mint broken (file_missing) scan entries for every bookmark of a deleted file. */
export function missingFileEntries(bookmarkIds: string[], uri: string): ScanResultEntry[] {
  return bookmarkIds.map((bookmarkId) => ({
    bookmarkId,
    uri,
    status: 'broken' as const,
    errorCode: FILE_MISSING_CODE,
    errorDetails: `Target file not found: ${uri}`,
    score: null,
  }));
}

/**
 * Build the authoritative cache after a scan. Entries for files the scan validated
 * (`scannedUris`) are fully replaced by `scannedEntries` (valid ones dropped, so a
 * now-clean file loses its stale entry); entries for files outside scan scope are
 * kept untouched. `discoveredAt` is preserved for bookmarks already in the cache.
 *
 * Invalidation is also bookmark-id-aware: any existing entry whose bookmark was
 * re-validated this scan is dropped even if its cached URI is outside `scannedUris`.
 * This clears stale entries after a cross-file repair moved a bookmark to a new
 * target (the old-URI entry would otherwise survive the URI-scoped rule).
 */
export function buildAuthoritativeCache(
  existing: BrokenAnchorEntry[],
  scannedUris: Set<string>,
  scannedEntries: ScanResultEntry[],
  now: number,
): BrokenAnchorEntry[] {
  const discoveredAtById = new Map<string, number>();
  for (const e of existing) discoveredAtById.set(e.bookmarkId, e.discoveredAt);

  // Bookmarks re-validated this scan (any status) — their stale entries are replaced
  // by the fresh results below, regardless of the old entry's URI.
  const scannedBookmarkIds = new Set(scannedEntries.map((e) => e.bookmarkId));

  const out: BrokenAnchorEntry[] = [];
  // Keep entries that were neither re-validated by id nor in a scanned file.
  for (const e of existing) {
    if (scannedBookmarkIds.has(e.bookmarkId)) continue;
    if (!scannedUris.has(e.uri)) out.push(e);
  }
  // Add fresh results for scanned files (broken + warning only).
  for (const s of scannedEntries) {
    if (s.status === 'valid') continue;
    out.push({
      bookmarkId: s.bookmarkId,
      uri: s.uri,
      status: s.status,
      errorCode: s.errorCode,
      errorDetails: s.errorDetails,
      score: s.score,
      discoveredAt: discoveredAtById.get(s.bookmarkId) ?? now,
    });
  }
  return out;
}
