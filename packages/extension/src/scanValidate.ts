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
 */
export function buildAuthoritativeCache(
  existing: BrokenAnchorEntry[],
  scannedUris: Set<string>,
  scannedEntries: ScanResultEntry[],
  now: number,
): BrokenAnchorEntry[] {
  const discoveredAtById = new Map<string, number>();
  for (const e of existing) discoveredAtById.set(e.bookmarkId, e.discoveredAt);

  const out: BrokenAnchorEntry[] = [];
  // Keep entries for files the scan did not touch.
  for (const e of existing) if (!scannedUris.has(e.uri)) out.push(e);
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
