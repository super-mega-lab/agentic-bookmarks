// ABOUTME: vscode-free helper for moving a bookmark across bookmark files.
// ABOUTME: Destination-first ordering makes the move loss-safe (SML-1520).

import type { BookmarksFileV2 } from '@agentic-bookmarks/core';

export interface BookmarkFileEditors {
  readFileV2: (paths: any) => Promise<BookmarksFileV2>;
  editFileV2: (paths: any, mutate: (f: BookmarksFileV2) => void | Promise<void>) => Promise<unknown>;
}

/**
 * Move a single bookmark from the source data file to the destination data
 * file, rewriting its `fileId`/`groupId` and bumping `updatedAt`.
 *
 * The cross-file move is two separate atomic writes (there is no transaction
 * across files), so the ORDER matters. This helper writes the DESTINATION
 * FIRST and only removes the bookmark from the source after that write
 * resolves. If the destination write throws, the source is left untouched and
 * the bookmark is never lost (SML-1520).
 *
 * The previous implementation removed the bookmark from the source first, so a
 * failed destination write destroyed the bookmark in both files (silent data
 * loss). Do not reorder these writes.
 *
 * Returns `true` when the bookmark was moved, `false` when it was not found in
 * the source (in which case nothing is written).
 */
export async function moveBookmarkAcrossFiles(
  editors: BookmarkFileEditors,
  srcPaths: any,
  dstPaths: any,
  bookmarkId: string,
  targetGroupId: string,
): Promise<boolean> {
  const srcFile = await editors.readFileV2(srcPaths);
  const moved = srcFile.bookmarks.find((b: any) => b.id === bookmarkId);
  if (!moved) return false;

  // Destination first: a fresh copy so the source object is never mutated.
  await editors.editFileV2(dstPaths, (file: any) => {
    file.bookmarks.unshift({
      ...moved,
      fileId: file.fileId,
      groupId: targetGroupId,
      updatedAt: Date.now(),
    });
  });

  // Only after the destination write resolves do we remove from the source.
  await editors.editFileV2(srcPaths, (file: any) => {
    const idx = file.bookmarks.findIndex((b: any) => b.id === bookmarkId);
    if (idx >= 0) file.bookmarks.splice(idx, 1);
  });

  return true;
}
