import { readFileV2, pathsForDataFile, getBookmarksDataRoot, type WorkspaceRegistryV1 } from '@agentic-bookmarks/core';

/** Compute workspace stats using canonical path resolution. */
export async function computeWorkspaceStats(
  reg: WorkspaceRegistryV1,
  workspaceRoot: string
): Promise<{ files: number; groups: number; bookmarks: number }> {
  const dataRoot = getBookmarksDataRoot(reg);
  let files = 0;
  let groups = 0;
  let bookmarks = 0;
  for (const f of reg.files) {
    if (f.enabled === false) continue;
    try {
      const p = pathsForDataFile(f.path, workspaceRoot, dataRoot);
      const data = await readFileV2(p, false);
      files++;
      groups += Array.isArray(data.groups) ? data.groups.length : 0;
      bookmarks += Array.isArray(data.bookmarks) ? data.bookmarks.length : 0;
    } catch {}
  }
  return { files, groups, bookmarks };
}
