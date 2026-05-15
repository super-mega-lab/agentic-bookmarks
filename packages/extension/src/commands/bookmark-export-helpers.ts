// ABOUTME: Pure renderer that turns BookmarkPickItem[] into Markdown using a
// ABOUTME: configurable template with ${file}/${line}/${endLine}/${label}/${group}/${note}.

import type { BookmarkPickItem } from './bookmark-quickpick-items';

export const DEFAULT_EXPORT_PATTERN: string =
  '- [`${file}:${line}`](${file}#L${line}) ${label}';

export type ExportRowFields = {
  /** Workspace-relative path of the bookmarked file. */
  file: string;
  /** 1-based start line for display. */
  line: number;
  /** 1-based end line for display (= line for non-range bookmarks). */
  endLine: number;
  /** Bookmark.label as stored. Empty string when user didn't supply one. */
  label: string;
  /** Group display name. */
  group: string;
  /** Bookmark.note as stored. Empty string when user didn't supply one. */
  note: string;
};

/**
 * Map a BookmarkPickItem to its corresponding ExportRowFields, converting
 * 0-based line numbers to 1-based for human-readable output.
 */
export function pickItemToExportRow(item: BookmarkPickItem): ExportRowFields {
  return {
    file: item.relativePath,
    line: item.line + 1,
    endLine: item.endLine + 1,
    label: item.label,
    group: item.groupName,
    note: item.note,
  };
}

/**
 * Render a single line of export output. Each occurrence of `${name}` (where
 * `name` is a known field of ExportRowFields) is replaced with the field's
 * stringified value. Unknown placeholders are left verbatim. The result is
 * `.trimEnd()`-ed so empty trailing variables don't leave dangling whitespace.
 */
export function renderExportLine(pattern: string, row: ExportRowFields): string {
  const rendered = pattern.replace(/\$\{(\w+)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const value = (row as Record<string, unknown>)[key];
      return String(value);
    }
    return match;
  });
  return rendered.trimEnd();
}

/**
 * Render every item in `items` via `renderExportLine`, joined by '\n'. Returns
 * '' when `items` is empty so callers can short-circuit to an empty document.
 */
export function renderBookmarksMarkdown(
  items: BookmarkPickItem[],
  pattern: string,
): string {
  if (items.length === 0) return '';
  return items
    .map((item) => renderExportLine(pattern, pickItemToExportRow(item)))
    .join('\n');
}
