// ABOUTME: Pure helper that builds BookmarkPickItem[] from registry + per-file bookmark data,
// ABOUTME: applying visibility/search filters and resolving anchor lines via injected callbacks.

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import {
  matchesTextQuery,
  COMMON_SEARCH_SCOPE,
  type BookmarksFileV2,
  type WorkspaceRegistryV1,
} from '@agentic-bookmarks/core';

/** Sub-search filter (mirrors the shape stored in `ui.searches`). */
export type SearchFilter = {
  id: string;
  text: string;
  regex: boolean;
  op: 'AND' | 'OR';
};

/** Pure data — no vscode types. Caller wraps these into QuickPickItems. */
export type BookmarkPickItem = {
  bookmarkId: string;
  fileId: string;
  groupId: string;
  /** Absolute fs path of the bookmarked file (resolved from workspace-relative URI). */
  fsPath: string;
  /** 0-based line number used for QuickPick display + cursor jump. */
  line: number;
  /** End line for range anchors; equals `line` for non-range. */
  endLine: number;
  /** Bookmark.label as stored. Empty string when user didn't supply one. */
  label: string;
  /** Group display name (from group.name). */
  groupName: string;
  /** Workspace-relative path of the bookmarked file (for 'all' scope display). */
  relativePath: string;
  /** Bookmark.note as stored. Empty string when user didn't supply one. */
  note: string;
};

export type BookmarkPickScope = 'inFile' | 'all';

export type Visibility = {
  /** Group IDs the user has hidden. Ignored when filterEnabled === false. */
  hidden: string[];
  /** Single focused group ID, or null. Ignored when filterEnabled === false. */
  focus: string | null;
  filterEnabled: boolean;
  /** Sub-search filters (AND/OR/regex). Ignored when filterEnabled === false. */
  searches?: SearchFilter[];
};

export type BuildBookmarkPickItemsOpts = {
  scope: BookmarkPickScope;
  /** When scope === 'inFile', limit to bookmarks targeting this file's fsPath. */
  activeFileFsPath?: string;
  /**
   * Per-file workspace root + bookmark data. Multiple roots support multi-root
   * workspaces. Each entry's `wsRoot` is the absolute path of the folder that
   * owns the registry + data file.
   */
  filesData: Array<{ wsRoot: string; regPath: string; data: BookmarksFileV2 }>;
  visibility: Visibility;
  /** Registry — supplied for downstream callers; not consumed by this helper. */
  registry: WorkspaceRegistryV1;
  /** Callback so the caller controls file-hidden semantics. Pure-helper-friendly. */
  isFileHidden: (fileId: string) => boolean;
  /**
   * Resolve a bookmark's current display line. Receives the bookmarked file's
   * absolute fs path so the caller can canonicalize to the form used by their
   * line-state cache (e.g. `vscode.Uri.file(fsPath).toString()`).
   */
  resolveLine: (bookmarkId: string, fsPath: string, fallback: number) => number;
};

function stripFragment(uri: string): string {
  const i = uri.indexOf('#');
  return i >= 0 ? uri.substring(0, i) : uri;
}

/**
 * Resolve a bookmark target.uri to an absolute fs path.
 * Mirrors bookmark-crud.ts fragment-stripping and treeProvider.ts uri normalization.
 */
function resolveFsPath(rawUri: string, workspaceRoot: string): string {
  const base = stripFragment(rawUri);
  if (base.startsWith('file://')) {
    try {
      return fileURLToPath(base);
    } catch {
      return base.slice('file://'.length);
    }
  }
  if (path.isAbsolute(base)) return base;
  return path.join(workspaceRoot, base);
}

/**
 * Compute the workspace-relative display path. If the bookmark's URI was already
 * workspace-relative, that's the answer (sans fragment). Otherwise we derive it
 * from fsPath relative to workspaceRoot. POSIX-style separators throughout.
 * Outside-workspace paths fall back to the absolute fsPath.
 */
function computeRelativePath(rawUri: string, fsPath: string, workspaceRoot: string): string {
  const base = stripFragment(rawUri);
  if (!base.startsWith('file://') && !path.isAbsolute(base)) {
    return base.split(path.sep).join('/');
  }
  const rel = path.relative(workspaceRoot, fsPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return fsPath.split(path.sep).join('/');
  }
  return rel.split(path.sep).join('/');
}

/**
 * Visibility predicate — must match treeProvider.ts. Focus wins:
 * when v.focus is set, only the focused group is visible; the
 * hidden list is ignored for that group.
 */
function isHiddenByVisibility(groupId: string, v: Visibility): boolean {
  if (!v.filterEnabled) return false;
  if (v.focus !== null) return v.focus !== groupId;
  return v.hidden.includes(groupId);
}

/**
 * Search-filter predicate — mirrors treeProvider.ts:184-208 (AND/OR/regex).
 * Returns true when the bookmark should be SHOWN.
 */
function matchesSearches(bookmark: any, v: Visibility): boolean {
  if (!v.filterEnabled) return true;
  const searches = v.searches ?? [];
  if (searches.length === 0) return true;
  const ands = searches.filter(s => s.op === 'AND');
  const ors = searches.filter(s => s.op === 'OR');
  const test = (s: SearchFilter): boolean => {
    if (s.regex) {
      try {
        const rx = new RegExp(s.text, 'i');
        if (rx.test(bookmark.label ?? '')) return true;
        if (bookmark.note && rx.test(bookmark.note)) return true;
        const lineCache = bookmark.anchor?.lineCache;
        if (lineCache && rx.test(lineCache)) return true;
        return false;
      } catch {
        return false;
      }
    }
    return matchesTextQuery(bookmark, s.text, COMMON_SEARCH_SCOPE);
  };
  const andOk = ands.every(test);
  const orOk = ors.length === 0 || ors.some(test);
  return andOk && orOk;
}

type AnchorLines = { endLine: number; fallback: number };

/**
 * Extract the fallback (start) line and the endLine from any anchor kind.
 * fallback feeds into resolveLine; endLine is preserved as-is for range anchors
 * so consumers retain the span.
 */
function anchorLines(anchor: any): AnchorLines {
  if (anchor.kind === 'range') {
    return { endLine: anchor.end.line, fallback: anchor.start.line };
  }
  if (anchor.kind === 'point') {
    return { endLine: anchor.line, fallback: anchor.line };
  }
  // smart | tag
  return { endLine: anchor.lastUpdatedLine, fallback: anchor.lastUpdatedLine };
}

export function buildBookmarkPickItems(opts: BuildBookmarkPickItemsOpts): BookmarkPickItem[] {
  // Defensive: scope=inFile without an active file means "no items".
  if (opts.scope === 'inFile' && !opts.activeFileFsPath) return [];

  const items: BookmarkPickItem[] = [];

  for (const { wsRoot, data } of opts.filesData) {
    const fileId = (data as any).fileId as string;
    if (opts.isFileHidden(fileId)) continue;

    const bookmarks = ((data as any).bookmarks as any[]) ?? [];
    for (const b of bookmarks) {
      // Group visibility filter (mirrors treeProvider.ts:178).
      if (isHiddenByVisibility(b.groupId, opts.visibility)) continue;

      // Sub-search filter (mirrors treeProvider.ts:184-208).
      if (!matchesSearches(b, opts.visibility)) continue;

      const fsPath = resolveFsPath(b.target.uri, wsRoot);

      // Scope filter.
      if (opts.scope === 'inFile' && fsPath !== opts.activeFileFsPath) continue;

      const isRange = b.anchor?.kind === 'range';
      const { endLine: rawEndLine, fallback } = anchorLines(b.anchor);

      const line = opts.resolveLine(b.id, fsPath, fallback);
      // For non-range anchors, line and endLine agree. Range anchors keep their
      // original end.line so consumers retain the span.
      const endLine = isRange ? rawEndLine : line;

      const group = (data as any).groups?.find((g: any) => g.id === b.groupId);
      const groupName = group?.name ?? '(unknown)';

      const relativePath = computeRelativePath(b.target.uri, fsPath, wsRoot);

      items.push({
        bookmarkId: b.id,
        fileId,
        groupId: b.groupId,
        fsPath,
        line,
        endLine,
        label: b.label ?? '',
        groupName,
        relativePath,
        note: b.note ?? '',
      });
    }
  }

  if (opts.scope === 'inFile') {
    items.sort((a, b) => a.line - b.line);
  } else {
    items.sort((a, b) => {
      const cmp = a.relativePath.localeCompare(b.relativePath);
      if (cmp !== 0) return cmp;
      return a.line - b.line;
    });
  }

  return items;
}
