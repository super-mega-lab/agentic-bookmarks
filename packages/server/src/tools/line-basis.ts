/**
 * Line-basis conversion helpers for the MCP wire boundary.
 *
 * Wire convention: 1-based line numbers (matches editor UI, grep -n, git blame,
 * compiler errors, etc.). Internal storage and resolution use 0-based to match
 * the VS Code Position API and array indexing.
 *
 * Apply `toInternal` immediately on entry from MCP arguments. Apply `toWire`
 * just before returning a response field.
 */

export function toInternal(wireLine: number): number {
  return wireLine - 1;
}

export function toWire(internalLine: number): number {
  return internalLine + 1;
}

import type { BookmarkAnchor } from '@agentic-bookmarks/core';

/**
 * Convert a wire-shape anchor (line fields 1-based) to internal (0-based).
 * Discriminated-union switch — adding a new anchor kind in core forces a
 * TypeScript exhaustiveness error here, preventing silent drift.
 */
export function anchorToInternal(a: BookmarkAnchor): BookmarkAnchor {
  switch (a.kind) {
    case 'point':
      return {
        ...a,
        line: toInternal(a.line),
        ...(a.lastUpdatedLine !== undefined && { lastUpdatedLine: toInternal(a.lastUpdatedLine) }),
      };
    case 'range':
      return {
        ...a,
        start: { ...a.start, line: toInternal(a.start.line) },
        end: { ...a.end, line: toInternal(a.end.line) },
        ...(a.lastUpdatedLine !== undefined && { lastUpdatedLine: toInternal(a.lastUpdatedLine) }),
      };
    case 'smart':
      return { ...a, lastUpdatedLine: toInternal(a.lastUpdatedLine) };
    case 'tag':
      return { ...a, lastUpdatedLine: toInternal(a.lastUpdatedLine) };
  }
  // Exhaustiveness: if a new kind is added to BookmarkAnchor, TS will fail above.
  const _exhaustive: never = a;
  return _exhaustive;
}

/** Convert an internal anchor (line fields 0-based) to wire shape (1-based). */
export function anchorToWire(a: BookmarkAnchor): BookmarkAnchor {
  switch (a.kind) {
    case 'point':
      return {
        ...a,
        line: toWire(a.line),
        ...(a.lastUpdatedLine !== undefined && { lastUpdatedLine: toWire(a.lastUpdatedLine) }),
      };
    case 'range':
      return {
        ...a,
        start: { ...a.start, line: toWire(a.start.line) },
        end: { ...a.end, line: toWire(a.end.line) },
        ...(a.lastUpdatedLine !== undefined && { lastUpdatedLine: toWire(a.lastUpdatedLine) }),
      };
    case 'smart':
      return { ...a, lastUpdatedLine: toWire(a.lastUpdatedLine) };
    case 'tag':
      return { ...a, lastUpdatedLine: toWire(a.lastUpdatedLine) };
  }
  const _exhaustive: never = a;
  return _exhaustive;
}
