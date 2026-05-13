import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  getCacheDir,
  getIconCacheDir,
  getLocalDir,
  getLogsDir,
} from '@agentic-bookmarks/core';

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function moveIfDestMissing(src: string, dst: string): Promise<'moved' | 'skipped' | 'noop'> {
  if (!(await exists(src))) return 'noop';
  if (await exists(dst)) return 'skipped';
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rename(src, dst);
  return 'moved';
}

async function moveDirContents(srcDir: string, dstDir: string): Promise<void> {
  if (!(await exists(srcDir))) return;
  await fs.mkdir(dstDir, { recursive: true });
  for (const entry of await fs.readdir(srcDir)) {
    await moveIfDestMissing(path.join(srcDir, entry), path.join(dstDir, entry));
  }
  // Remove src dir if empty (idempotency: leaves it in place if any moves were skipped)
  try {
    const remaining = await fs.readdir(srcDir);
    if (remaining.length === 0) await fs.rmdir(srcDir);
  } catch {
    // best-effort
  }
}

/**
 * Move pre-existing local-runtime files into `.bookmarks/local/` for
 * workspaces last touched by an older version of the extension.
 *
 * Sources, in order:
 *   1. `.vscode/bookmarks.registry.json(.bak)` → `.bookmarks/local/`
 *   2. `.vscode/bookmark-icon-cache/*` → `.bookmarks/local/.cache/icons/`
 *   3. `.bookmarks/.cache/` (root-level) → `.bookmarks/local/.cache/`
 *   4. `.bookmarks/logs/`  (root-level) → `.bookmarks/local/logs/`
 *
 * Each move is guarded: if the destination already exists, the source is
 * left in place so an operator can resolve the conflict explicitly. The
 * function never deletes `.vscode/` itself — `launch.json`, `tasks.json`,
 * and `mcp.json` legitimately live there. Re-running the function is a
 * no-op once the new locations are populated.
 */
export async function migrateLocalLayout(workspaceRoot: string): Promise<void> {
  const localDir = getLocalDir(workspaceRoot);

  // 1. Registry + .bak from .vscode/
  await moveIfDestMissing(
    path.join(workspaceRoot, '.vscode', 'bookmarks.registry.json'),
    path.join(localDir, 'bookmarks.registry.json'),
  );
  await moveIfDestMissing(
    path.join(workspaceRoot, '.vscode', 'bookmarks.registry.json.bak'),
    path.join(localDir, 'bookmarks.registry.json.bak'),
  );

  // 2. Icon cache from .vscode/bookmark-icon-cache/
  await moveDirContents(
    path.join(workspaceRoot, '.vscode', 'bookmark-icon-cache'),
    getIconCacheDir(workspaceRoot),
  );

  // 3. Old root-level .bookmarks/.cache → .bookmarks/local/.cache
  await moveDirContents(
    path.join(workspaceRoot, '.bookmarks', '.cache'),
    getCacheDir(workspaceRoot),
  );

  // 4. Old root-level .bookmarks/logs → .bookmarks/local/logs
  await moveDirContents(
    path.join(workspaceRoot, '.bookmarks', 'logs'),
    getLogsDir(workspaceRoot),
  );
}
