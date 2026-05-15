// ABOUTME: Pure helpers for bookmark jump navigation — pickJumpTarget,
// ABOUTME: collectVisibleBookmarks, mapRevealType. vscode-API-free by design.

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import {
  matchesTextQuery,
  COMMON_SEARCH_SCOPE,
  type BookmarksFileV2,
  type WorkspaceRegistryV1,
} from '@agentic-bookmarks/core';
import type { Logger } from '../logger';

export interface VisibleBookmark {
  bookmarkId: string;
  /** Absolute filesystem path; used as cross-file sort key. */
  fileFsPath: string;
  /** Absolute `file://` URI suitable for `vscode.Uri.parse`. */
  fileAbsoluteUri: string;
  /** 0-based live line. */
  line: number;
  workspaceRoot: string;
  dataFilePath: string;
  groupId: string;
}

export type JumpDirection = 'next' | 'prev';

export type RevealLocation = 'top' | 'center';

export interface JumpSettings {
  navigateThroughAllFiles: boolean;
  wrapNavigation: boolean;
  revealLocation: RevealLocation;
}

export interface CursorPosition {
  fileFsPath: string;
  line: number;
}

type SearchFilter = { id: string; text: string; regex: boolean; op: 'AND' | 'OR' };

export interface UIStateForJump {
  hidden: string[];
  focus: string | null;
  filterEnabled?: boolean;
  searches?: SearchFilter[];
  hiddenFiles?: string[];
}

// VS Code's TextEditorRevealType values (verified against
// node_modules/@types/vscode/index.d.ts):
//   Default = 0, InCenter = 1, InCenterIfOutsideViewport = 2, AtTop = 3.
// `mapRevealType` returns the integer constant so the helper stays
// vscode-free and unit-testable. The command handler casts the result to
// `vscode.TextEditorRevealType`.
const REVEAL_AT_TOP = 3;
const REVEAL_IN_CENTER = 1;

export function mapRevealType(loc: RevealLocation): number {
  return loc === 'top' ? REVEAL_AT_TOP : REVEAL_IN_CENTER;
}

// ---------------------------------------------------------------------------
// pickJumpTarget — pure synchronous selection
// ---------------------------------------------------------------------------

// Stable string compare. Plain `<` / `>` on filesystem paths is
// deterministic across machines, unlike `localeCompare` whose order can
// shift with the user's locale.
function compareFsPath(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isAfter(b: VisibleBookmark, cursor: CursorPosition): boolean {
  if (b.fileFsPath === cursor.fileFsPath) return b.line > cursor.line;
  return compareFsPath(b.fileFsPath, cursor.fileFsPath) > 0;
}

function isBefore(b: VisibleBookmark, cursor: CursorPosition): boolean {
  if (b.fileFsPath === cursor.fileFsPath) return b.line < cursor.line;
  return compareFsPath(b.fileFsPath, cursor.fileFsPath) < 0;
}

/**
 * Returns the next/prev visible bookmark relative to `cursor`, honoring the
 * `navigateThroughAllFiles` and `wrapNavigation` settings.
 *
 * Caller must supply `bookmarks` already sorted by
 * `(fileFsPath localeCompare, line ascending)`.
 *
 * Returns null when no jump target is available (empty list, no candidate in
 * scope, or wrap disabled at boundary).
 */
export function pickJumpTarget(
  bookmarks: VisibleBookmark[],
  cursor: CursorPosition,
  direction: JumpDirection,
  settings: Pick<JumpSettings, 'navigateThroughAllFiles' | 'wrapNavigation'>,
): VisibleBookmark | null {
  if (bookmarks.length === 0) return null;

  const scope = settings.navigateThroughAllFiles
    ? bookmarks
    : bookmarks.filter(b => b.fileFsPath === cursor.fileFsPath);

  if (scope.length === 0) return null;

  if (direction === 'next') {
    const candidate = scope.find(b => isAfter(b, cursor));
    if (candidate) return candidate;
    return settings.wrapNavigation ? scope[0] : null;
  }

  // direction === 'prev' — walk forward keeping the last item before cursor
  // (relies on sorted scope; once we see something not-before, all later
  // items are >= cursor).
  let lastBefore: VisibleBookmark | null = null;
  for (const b of scope) {
    if (isBefore(b, cursor)) lastBefore = b;
    else break;
  }
  if (lastBefore) return lastBefore;
  return settings.wrapNavigation ? scope[scope.length - 1] : null;
}

// ---------------------------------------------------------------------------
// collectVisibleBookmarks — registry traversal with injected I/O
// ---------------------------------------------------------------------------

export interface CollectVisibleBookmarksOptions {
  workspaceFolders: Array<{ uri: { fsPath: string } }>;
  readRegistry: (wsRoot: string) => Promise<WorkspaceRegistryV1>;
  readFileV2: (paths: { dir: string; data: string; bak: string; lock: string; pulse: string }) => Promise<BookmarksFileV2>;
  pathsForDataFile: (
    filePath: string,
    workspaceRoot: string,
    bookmarksDataRoot: string,
  ) => { dir: string; data: string; bak: string; lock: string; pulse: string };
  getBookmarksDataRoot: (registry: WorkspaceRegistryV1) => string;
  workspaceRelativeToUri: (relativePath: string, workspaceRoot: string) => string;
  /** Resolves a smart/tag anchor's live line; undefined when not yet resolved. */
  getResolvedLine: (absoluteUri: string, bookmarkId: string) => number | undefined;
  /** True when a file is hidden (registry-disabled or in `UIState.hiddenFiles`). */
  isFileHidden: (fileId: string, registry: WorkspaceRegistryV1) => boolean;
  getUIState: () => UIStateForJump;
  /** Optional logger for non-fatal read errors. */
  log?: Logger;
}

function resolveAbsoluteFsPath(
  uri: string,
  wsRoot: string,
  workspaceRelativeToUriFn: (rel: string, wsRoot: string) => string,
): { fsPath: string; absoluteUri: string } {
  const base = uri.split('#')[0];
  const absoluteUri = base.startsWith('file://') ? base : workspaceRelativeToUriFn(base, wsRoot);
  let fsPath: string;
  if (absoluteUri.startsWith('file://')) {
    try {
      fsPath = fileURLToPath(absoluteUri);
    } catch {
      fsPath = absoluteUri;
    }
  } else if (path.isAbsolute(absoluteUri)) {
    fsPath = absoluteUri;
  } else {
    fsPath = path.join(wsRoot, absoluteUri);
  }
  return { fsPath, absoluteUri };
}

function liveLineFor(
  bookmark: BookmarksFileV2['bookmarks'][number],
  absoluteUri: string,
  getResolvedLineFn: (absoluteUri: string, bookmarkId: string) => number | undefined,
): number {
  const anchor = bookmark.anchor as any;
  if (anchor.kind === 'point') return anchor.line;
  if (anchor.kind === 'range') return anchor.start.line;
  // smart / tag
  const resolved = getResolvedLineFn(absoluteUri, (bookmark as any).id);
  if (typeof resolved === 'number') return resolved;
  return anchor.lastUpdatedLine;
}

function bookmarkMatchesSearches(
  bookmark: BookmarksFileV2['bookmarks'][number],
  searches: SearchFilter[],
): boolean {
  if (searches.length === 0) return true;
  const ands = searches.filter(s => s.op === 'AND');
  const ors = searches.filter(s => s.op === 'OR');
  const test = (s: SearchFilter): boolean => {
    if (s.regex) {
      try {
        const rx = new RegExp(s.text, 'i');
        if (rx.test((bookmark as any).label)) return true;
        if ((bookmark as any).note && rx.test((bookmark as any).note)) return true;
        const anchor = (bookmark as any).anchor;
        if (anchor?.lineCache && rx.test(anchor.lineCache)) return true;
        return false;
      } catch {
        return false;
      }
    }
    return matchesTextQuery(bookmark as any, s.text, COMMON_SEARCH_SCOPE);
  };
  const andOk = ands.every(test);
  const orOk = ors.length === 0 || ors.some(test);
  return andOk && orOk;
}

/**
 * Collect all bookmarks that should participate in jump navigation, applying
 * the same visibility predicates the tree view uses (registry enabled,
 * UIState.hiddenFiles, group hidden/focus, search filters).
 *
 * Returns an array sorted by `(fileFsPath localeCompare, line ascending)`.
 */
export async function collectVisibleBookmarks(
  opts: CollectVisibleBookmarksOptions,
): Promise<VisibleBookmark[]> {
  const ui = opts.getUIState();
  const filterEnabled = ui.filterEnabled === true;
  const hidden = ui.hidden ?? [];
  const focus = ui.focus ?? null;
  const searches = Array.isArray(ui.searches) ? ui.searches : [];

  const out: VisibleBookmark[] = [];

  for (const folder of opts.workspaceFolders) {
    const wsRoot = folder.uri.fsPath;
    let reg: WorkspaceRegistryV1;
    try {
      reg = await opts.readRegistry(wsRoot);
    } catch (err) {
      opts.log?.error(`[bookmark-jump] readRegistry failed for ${wsRoot}: ${err}`);
      continue;
    }
    const dataRoot = opts.getBookmarksDataRoot(reg);

    for (const rf of reg.files) {
      const fileId = (rf as any).fileId as string;
      if (opts.isFileHidden(fileId, reg)) {
        // Bullseye trumps file-level UI-hide (extends SML-1380's
        // focus-wins precedence to the file boundary). Registry-disable
        // always wins.
        if ((rf as any).enabled === false) continue;
        if (!filterEnabled || focus === null) continue;
      }
      let file: BookmarksFileV2;
      try {
        const p = opts.pathsForDataFile(rf.path, wsRoot, dataRoot);
        file = await opts.readFileV2(p);
      } catch (err) {
        opts.log?.error(`[bookmark-jump] readFileV2 failed for ${rf.path}: ${err}`);
        continue;
      }

      for (const bookmark of file.bookmarks) {
        const groupId = (bookmark as any).groupId as string;

        if (filterEnabled) {
          // Mirror treeProvider.getChildren's predicate. Focus wins over
          // hidden: when a focus is set, ONLY the focused group is visible
          // (and the hidden list is ignored for that group).
          const isHidden =
            focus !== null ? focus !== groupId : hidden.includes(groupId);
          if (isHidden) continue;
          if (!bookmarkMatchesSearches(bookmark, searches)) continue;
        }

        const { fsPath, absoluteUri } = resolveAbsoluteFsPath(
          bookmark.target.uri,
          wsRoot,
          opts.workspaceRelativeToUri,
        );
        const line = liveLineFor(bookmark, absoluteUri, opts.getResolvedLine);

        out.push({
          bookmarkId: (bookmark as any).id as string,
          fileFsPath: fsPath,
          fileAbsoluteUri: absoluteUri,
          line,
          workspaceRoot: wsRoot,
          dataFilePath: rf.path,
          groupId,
        });
      }
    }
  }

  out.sort((a, b) => {
    const c = compareFsPath(a.fileFsPath, b.fileFsPath);
    if (c !== 0) return c;
    return a.line - b.line;
  });
  return out;
}
