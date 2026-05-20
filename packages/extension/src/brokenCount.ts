// ABOUTME: Pure helper to count genuinely-broken anchors from broken-anchors cache
// ABOUTME: entries. Warnings are excluded; broken bookmarkIds are deduped.
import type { brokenAnchorsCache } from '@agentic-bookmarks/core';

export function countBroken(entries: brokenAnchorsCache.BrokenAnchorEntry[]): number {
  const ids = new Set<string>();
  for (const e of entries) if (e.status === 'broken') ids.add(e.bookmarkId);
  return ids.size;
}
