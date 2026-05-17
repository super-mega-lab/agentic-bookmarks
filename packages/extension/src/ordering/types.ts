/**
 * Sort/ordering data model. See docs/plans/2026-05-16-local-sort-design.md.
 *
 * Context keys identify which "slot" a rank applies to:
 *   'a' — All Bookmarks, flat (showFiles=false): bookmarks sorted relative to all visible bookmarks
 *   'f' — within-file: bookmarks under a file (All Bookmarks showFiles=true), groups under a file (F&G),
 *         bookmark-files under a workspace (F&G)
 *   'g' — within-group: bookmarks under a group (F&G showBookmarks=true)
 */
export type ContextKey = 'a' | 'f' | 'g';

export type EntityKind = 'bookmark' | 'file' | 'group' | 'bookmarkFile';

export type RankRecord = Partial<Record<ContextKey, number>>;

export interface OrderingCache {
  bookmarks:     Record<string, RankRecord>;
  files:         Record<string, RankRecord>;
  groups:        Record<string, RankRecord>;
  bookmarkFiles: Record<string, RankRecord>;
}

export function emptyOrderingCache(): OrderingCache {
  return { bookmarks: {}, files: {}, groups: {}, bookmarkFiles: {} };
}

export type SortMode = 'default' | 'user' | 'recent';

/** On-disk serialized form — arrays sorted by id for stable diffs. */
export interface OrderingFileV1 {
  v: 1;
  bookmarks:     Array<{ id: string; ranks: RankRecord }>;
  files:         Array<{ id: string; ranks: RankRecord }>;
  groups:        Array<{ id: string; ranks: RankRecord }>;
  bookmarkFiles: Array<{ id: string; ranks: RankRecord }>;
}
