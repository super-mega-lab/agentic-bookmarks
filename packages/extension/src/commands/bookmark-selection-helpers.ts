// ABOUTME: Pure helpers for bookmark selection commands —
// ABOUTME: buildLineSelections, computeExpandedSelection, computeShrunkSelection.

import type { VisibleBookmark } from './bookmark-jump-helpers';

/**
 * Pure description of a selection range. Independent of vscode.* so the helpers
 * stay testable without mocks. The command surface converts to vscode.Selection.
 *
 * Lines are 0-based. `endLine` may equal `startLine` for a single-line range.
 * `endCharacter` of -1 is a sentinel meaning "end of line"; the command surface
 * resolves it against the live document.
 */
export interface LineRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number; // -1 means "end of line"
}

export interface AnchorActive {
  /** Anchor line (where the selection started). 0-based. */
  anchorLine: number;
  /** Active line (where the cursor currently is). 0-based. */
  activeLine: number;
}

export type ExpandDirection = 'next' | 'prev';

function activeFileLinesSorted(
  bookmarks: VisibleBookmark[],
  activeFileFsPath: string,
): number[] {
  const seen = new Set<number>();
  for (const b of bookmarks) {
    if (b.fileFsPath !== activeFileFsPath) continue;
    seen.add(b.line);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * Build one full-line selection per unique bookmarked line in the active file.
 * Lines from other files are filtered out. Result is sorted ascending by line.
 *
 * `endCharacter: -1` marks "end of line" — the wrapper resolves it against the
 * live document (because helpers are vscode-free and don't have line-length info).
 */
export function buildLineSelections(
  bookmarks: VisibleBookmark[],
  activeFileFsPath: string,
): LineRange[] {
  const lines = activeFileLinesSorted(bookmarks, activeFileFsPath);
  return lines.map(line => ({
    startLine: line,
    startCharacter: 0,
    endLine: line,
    endCharacter: -1,
  }));
}

/**
 * Returns the new active line for an expand operation, or null if there is no
 * further bookmark in `direction` past `current.activeLine` in the active file.
 *
 * The anchor is preserved by the wrapper; this helper only computes the new
 * active end. `bookmarks` may include bookmarks from other files — they are
 * filtered out internally.
 */
export function computeExpandedSelection(
  bookmarks: VisibleBookmark[],
  activeFileFsPath: string,
  current: AnchorActive,
  direction: ExpandDirection,
): { newActiveLine: number } | null {
  const lines = activeFileLinesSorted(bookmarks, activeFileFsPath);
  if (lines.length === 0) return null;

  if (direction === 'next') {
    const found = lines.find(L => L > current.activeLine);
    return typeof found === 'number' ? { newActiveLine: found } : null;
  }

  // direction === 'prev' — largest line strictly less than activeLine.
  let last: number | null = null;
  for (const L of lines) {
    if (L < current.activeLine) last = L;
    else break;
  }
  return last !== null ? { newActiveLine: last } : null;
}

/**
 * Returns the new active line for a shrink operation. Moves the active end
 * one bookmark line closer to the anchor. Returns:
 *   - { newActiveLine } if a strictly-intermediate bookmark line exists
 *   - { newActiveLine: anchorLine } to collapse to anchor when none exists
 *   - null if the selection was already collapsed (anchor == active)
 */
export function computeShrunkSelection(
  bookmarks: VisibleBookmark[],
  activeFileFsPath: string,
  current: AnchorActive,
): { newActiveLine: number } | null {
  if (current.anchorLine === current.activeLine) return null;

  const lines = activeFileLinesSorted(bookmarks, activeFileFsPath);

  if (current.activeLine > current.anchorLine) {
    // Selection extends downward. Find largest L with anchorLine < L < activeLine.
    let largest: number | null = null;
    for (const L of lines) {
      if (L > current.anchorLine && L < current.activeLine) {
        if (largest === null || L > largest) largest = L;
      }
    }
    if (largest !== null) return { newActiveLine: largest };
    return { newActiveLine: current.anchorLine };
  }

  // Selection extends upward. Find smallest L with activeLine < L < anchorLine.
  for (const L of lines) {
    if (L > current.activeLine && L < current.anchorLine) {
      return { newActiveLine: L };
    }
  }
  return { newActiveLine: current.anchorLine };
}
