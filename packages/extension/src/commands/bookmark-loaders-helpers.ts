// ABOUTME: Pure helper that composes the multi-root file-hidden predicate used
// ABOUTME: by the list quick-picks, export, and bulk open/scan commands.

import type { WorkspaceRegistryV1 } from '@agentic-bookmarks/core';
import type { Visibility } from './bookmark-quickpick-items';
import type { LoadedFile, LoadedFolder } from './bookmark-loaders';

/**
 * Build the per-fileId predicate that decides whether a bookmark file is
 * hidden across all loaded workspace folders.
 *
 * Returns a closure with the following precedence:
 *   - fileId not owned by any loaded folder → false (visible)
 *   - underlying `isFileHidden` returns false → false (visible)
 *   - registry entry has `enabled === false` → true (registry-disable wins)
 *   - otherwise, true unless Bullseye (filterEnabled + focus !== null) is on
 */
export function composeFileHiddenPredicate(
  folders: LoadedFolder[],
  filesData: LoadedFile[],
  visibility: Visibility,
  isFileHidden: (fileId: string, reg: WorkspaceRegistryV1) => boolean,
): (fileId: string) => boolean {
  const foldersByRoot = new Map(folders.map((f) => [f.wsRoot, f]));
  const fileFolderById = new Map<string, LoadedFolder>();
  for (const f of filesData) {
    const fileId = (f.data as { fileId: string }).fileId;
    const folder = foldersByRoot.get(f.wsRoot);
    if (folder) fileFolderById.set(fileId, folder);
  }
  return (fileId: string): boolean => {
    const folder = fileFolderById.get(fileId);
    if (!folder) return false;
    if (!isFileHidden(fileId, folder.reg)) return false;
    // Bullseye trumps file-level UI-hide (extends SML-1380's focus-wins
    // precedence to the file boundary). Registry-disable still wins.
    const file = folder.reg.files.find((x) => x.fileId === fileId);
    if ((file as { enabled?: boolean })?.enabled === false) return true;
    return !(visibility.filterEnabled && visibility.focus !== null);
  };
}
