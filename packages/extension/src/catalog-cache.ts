/**
 * Style-catalog on-disk cache.
 *
 * Provides `getBuiltinCatalog(context)` — the single chokepoint for catalog
 * loading. Reads from the extension's bundled `media/styles/` directory.
 * The previous `getCatalogFromSettings(styleCatalogPath, root)` API was
 * retired in SML-1320 (locked-down catalog surface).
 *
 * NOTE for pro-mode: when user-supplied catalogs return as a paid feature,
 * swap the path resolution here (gated on a feature flag) — the rest of
 * the renderer doesn't change.
 */

import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import * as vscode from 'vscode';
import { loadStyleCatalog } from '@agentic-bookmarks/core';

type CachedCatalog = {
  path: string;
  mtimeMs: number;
  data: any;
  baseDir: string;
} | null;

let catalogCache: CachedCatalog = null;

/**
 * Load the built-in catalog shipped with the extension.
 * Cached by mtime; subsequent calls are cheap.
 */
export async function getBuiltinCatalog(
  context: vscode.ExtensionContext,
): Promise<{ data: any; baseDir: string } | null> {
  const baseDir = context.asAbsolutePath(path.join('media', 'styles'));
  const catalogPath = path.join(baseDir, 'catalog.json');
  try {
    const st = await fsp.stat(catalogPath);
    if (
      catalogCache &&
      catalogCache.path === catalogPath &&
      Math.abs(catalogCache.mtimeMs - st.mtimeMs) < 1
    ) {
      return { data: catalogCache.data, baseDir: catalogCache.baseDir };
    }
    const data = await loadStyleCatalog(catalogPath);
    catalogCache = { path: catalogPath, mtimeMs: st.mtimeMs, data, baseDir };
    return { data, baseDir };
  } catch {
    catalogCache = null;
    return null;
  }
}

/** Invalidate the cached catalog (e.g. after style edits in pro-mode). */
export function clearCatalogCache(): void {
  catalogCache = null;
}

/** Peek at the current cache entry (for diagnostics). */
export function getCatalogCache(): { path: string; baseDir: string } | null {
  return catalogCache ? { path: catalogCache.path, baseDir: catalogCache.baseDir } : null;
}
