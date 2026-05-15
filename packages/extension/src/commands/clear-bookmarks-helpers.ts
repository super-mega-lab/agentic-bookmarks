// ABOUTME: Pure helpers for bulk-clearing bookmarks. Partition bookmarks by a
// ABOUTME: predicate and surface tag-anchor lines that need source-file cleanup.

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { BookmarksFileV2 } from '@agentic-bookmarks/core';

export interface TagAnchorRemoval {
  /** workspace-relative or file:// URI of the bookmark's source file */
  sourceUri: string;
  /** 0-based line number where the @bookmark:<tagId> comment sits */
  line: number;
  /** the bookmark's anchor.tagId */
  tagId: string;
}

export interface PartitionResult {
  /** Bookmarks the predicate did NOT match — keep these */
  kept: BookmarksFileV2['bookmarks'];
  /** Bookmarks the predicate matched — to be removed */
  cleared: BookmarksFileV2['bookmarks'];
  /** Tag-anchor entries that need their @bookmark:<id> comment stripped from source files */
  tagAnchorsToRemove: TagAnchorRemoval[];
}

/**
 * Partition a file's bookmarks by a predicate. Bookmarks the predicate matches
 * are placed in `cleared`; the rest in `kept`. For tag-anchored bookmarks among
 * the cleared set, an entry is added to `tagAnchorsToRemove` so the caller can
 * strip the corresponding `@bookmark:<tagId>` comment from the source file
 * (mirrors the cleanup performed by `agenticBookmarks.removeAtLine` in
 * bookmark-crud.ts:545).
 */
export function partitionBookmarksForClear(
  file: BookmarksFileV2,
  predicate: (b: BookmarksFileV2['bookmarks'][number]) => boolean
): PartitionResult {
  const kept: BookmarksFileV2['bookmarks'] = [];
  const cleared: BookmarksFileV2['bookmarks'] = [];
  const tagAnchorsToRemove: TagAnchorRemoval[] = [];

  for (const b of file.bookmarks) {
    if (predicate(b)) {
      cleared.push(b);
      const anchor = (b as any).anchor;
      if (anchor && anchor.kind === 'tag') {
        tagAnchorsToRemove.push({
          sourceUri: (b as any).target.uri,
          line: anchor.lastUpdatedLine,
          tagId: anchor.tagId,
        });
      }
    } else {
      kept.push(b);
    }
  }

  return { kept, cleared, tagAnchorsToRemove };
}

/**
 * Returns true when a bookmark targets the file at `activeFsPath`. Resolves the
 * bookmark's `target.uri` (which may be a `file://` URI or a workspace-relative
 * path, optionally with a `#fragment`) to an absolute filesystem path using the
 * same logic as `agenticBookmarks.removeAtLine` (bookmark-crud.ts:571-581).
 */
export function bookmarkMatchesActiveFile(
  bookmark: BookmarksFileV2['bookmarks'][number],
  activeFsPath: string,
  workspaceRoot: string
): boolean {
  const base = (bookmark as any).target.uri.split('#')[0];
  let bFs = '';

  if (base.startsWith('file://')) {
    try {
      bFs = fileURLToPath(base);
    } catch {
      bFs = base;
    }
  } else {
    try {
      bFs = path.isAbsolute(base) ? base : path.join(workspaceRoot, base);
    } catch {
      bFs = base;
    }
  }

  return bFs === activeFsPath;
}
