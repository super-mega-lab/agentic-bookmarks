// ABOUTME: Pure helper that locates bookmarks at a given line in a BookmarksFileV2,
// ABOUTME: with optional visibility filtering by group hidden/focus state.

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { BookmarksFileV2 } from '@agentic-bookmarks/core';

export interface FindOptions {
  /** Filesystem path of the active document (matched against bookmark target URIs) */
  fsPath: string;
  /** Workspace root used to resolve workspace-relative bookmark URIs */
  workspaceRoot: string;
  /** 0-based line number to match */
  line: number;
  /**
   * Optional UI visibility filter. When provided, bookmarks whose group is
   * hidden (or not the focused group, when focus is set) are skipped. The
   * focused group always passes — even if also listed in hidden.
   */
  visibility?: { hidden: string[]; focus: string | null };
  /** Resolves a smart/tag bookmark's live line; undefined when unresolved/broken. Point/range ignore it. */
  resolveLine?: (bookmarkId: string) => number | undefined;
}

export interface LineMatch {
  bookmarkId: string;
  groupId: string;
  anchorKind: 'point' | 'range' | 'tag' | 'smart';
  /** Tag-anchor identifier (only set when anchorKind === 'tag') */
  tagId?: string;
  /** Tag anchor's lastUpdatedLine (only set when anchorKind === 'tag') */
  tagLine?: number;
}

function resolveBookmarkFsPath(uri: string, workspaceRoot: string): string {
  const base = uri.split('#')[0];
  if (base.startsWith('file://')) {
    try {
      return fileURLToPath(base);
    } catch {
      return base;
    }
  }
  if (path.isAbsolute(base)) return base;
  return path.join(workspaceRoot, base);
}

function isVisible(
  groupId: string,
  visibility: { hidden: string[]; focus: string | null }
): boolean {
  if (visibility.focus !== null) {
    return groupId === visibility.focus;
  }
  return !visibility.hidden.includes(groupId);
}

/** point -> anchor.line; range -> anchor.start.line; smart/tag -> resolveLive() ?? anchor.lastUpdatedLine */
export function effectiveAnchorLine(
  anchor: any,
  resolveLive: () => number | undefined,
): number {
  if (anchor.kind === 'point') return anchor.line;
  if (anchor.kind === 'range') return anchor.start.line;
  const live = resolveLive();
  return typeof live === 'number' ? live : anchor.lastUpdatedLine;
}

export function findBookmarksOnLineMatching(
  file: BookmarksFileV2,
  opts: FindOptions
): LineMatch[] {
  const matches: LineMatch[] = [];
  for (const b of file.bookmarks as any[]) {
    if (opts.visibility && !isVisible(b.groupId, opts.visibility)) continue;

    const bFs = resolveBookmarkFsPath(b.target.uri, opts.workspaceRoot);
    if (bFs !== opts.fsPath) continue;

    const anchor = b.anchor;
    let lineMatches = false;
    let match: LineMatch | null = null;

    if (anchor.kind === 'point') {
      lineMatches = anchor.line === opts.line;
      if (lineMatches) {
        match = { bookmarkId: b.id, groupId: b.groupId, anchorKind: 'point' };
      }
    } else if (anchor.kind === 'range') {
      lineMatches = anchor.start.line === opts.line;
      if (lineMatches) {
        match = { bookmarkId: b.id, groupId: b.groupId, anchorKind: 'range' };
      }
    } else if (anchor.kind === 'tag') {
      const liveLine = effectiveAnchorLine(anchor, () => opts.resolveLine?.(b.id));
      lineMatches = liveLine === opts.line;
      if (lineMatches) {
        match = {
          bookmarkId: b.id,
          groupId: b.groupId,
          anchorKind: 'tag',
          tagId: anchor.tagId,
          tagLine: liveLine,
        };
      }
    } else if (anchor.kind === 'smart') {
      const liveLine = effectiveAnchorLine(anchor, () => opts.resolveLine?.(b.id));
      lineMatches = liveLine === opts.line;
      if (lineMatches) {
        match = { bookmarkId: b.id, groupId: b.groupId, anchorKind: 'smart' };
      }
    }

    if (match) matches.push(match);
  }
  return matches;
}
