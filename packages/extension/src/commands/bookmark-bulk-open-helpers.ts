// ABOUTME: Pure helpers that collect the unique set of bookmarked files for the
// ABOUTME: Open/Scan all-files commands. Visible vs including-hidden scopes both
// ABOUTME: funnel through buildBookmarkPickItems for consistent dedupe and sort.

import {
  buildBookmarkPickItems,
  type Visibility,
} from './bookmark-quickpick-items';
import type { LoadedFile, LoadedFolder } from './bookmark-loaders';

// Re-exported so callers and tests can import the loaded-file shapes from
// this module without taking a second dependency on bookmark-loaders.
export type { LoadedFile, LoadedFolder };

/** One file the Open/Scan runner will load. */
export type BulkOpenTarget = {
  /** Absolute filesystem path of the bookmarked file. */
  fsPath: string;
  /** Workspace-relative path (POSIX separators) for sort + display. */
  relativePath: string;
};

function dedupeAndSort(
  items: Array<{ fsPath: string; relativePath: string }>
): BulkOpenTarget[] {
  const seen = new Set<string>();
  const out: BulkOpenTarget[] = [];
  for (const it of items) {
    if (seen.has(it.fsPath)) continue;
    seen.add(it.fsPath);
    out.push({ fsPath: it.fsPath, relativePath: it.relativePath });
  }
  // buildBookmarkPickItems already sorts items by relativePath then line for
  // scope:'all', so dedupe preserves order. Sort here as belt-and-suspenders
  // so callers can rely on the order without inspecting the helper internals.
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}

/**
 * Visible scope — uses buildBookmarkPickItems({scope:'all'}) so UI visibility
 * (filterEnabled + hidden groups + hidden files + search filters) is honored
 * exactly the same as listAll. When filterEnabled is false, all UI filters are
 * inert and every bookmarked file is included.
 */
export function collectVisibleBookmarkedFiles(opts: {
  filesData: LoadedFile[];
  visibility: Visibility;
  composedIsFileHidden: (fileId: string) => boolean;
}): BulkOpenTarget[] {
  const { filesData, visibility, composedIsFileHidden } = opts;
  const items = buildBookmarkPickItems({
    scope: 'all',
    visibility,
    filesData,
    isFileHidden: composedIsFileHidden,
  });
  return dedupeAndSort(items);
}

/**
 * Including-hidden scope — every file in any folder's registry with
 * enabled !== false and at least one bookmark. Mirrors clearAll's
 * registry-enabled-only semantics; UI visibility is intentionally ignored.
 */
export function collectAllRegisteredBookmarkedFiles(opts: {
  folders: LoadedFolder[];
  filesData: LoadedFile[];
}): BulkOpenTarget[] {
  const { folders, filesData } = opts;

  // Build the enabled-fileId set across every folder. Files where
  // enabled === false (explicit) are excluded; missing/true enabled is kept.
  const enabledFileIds = new Set<string>();
  for (const folder of folders) {
    for (const rf of folder.reg.files) {
      if ((rf as { enabled?: boolean }).enabled !== false) {
        enabledFileIds.add(rf.fileId);
      }
    }
  }

  const isFileHidden = (fileId: string) => !enabledFileIds.has(fileId);

  // filterEnabled:false → group-hide list and search filters are inert in
  // buildBookmarkPickItems, so every bookmark in every enabled file flows
  // through. The registry-enabled filter happens via isFileHidden above.
  const visibility: Visibility = {
    hidden: [],
    focus: null,
    filterEnabled: false,
    searches: [],
  };

  const items = buildBookmarkPickItems({
    scope: 'all',
    visibility,
    filesData,
    isFileHidden,
  });
  return dedupeAndSort(items);
}
