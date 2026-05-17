import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { emptyOrderingCache, type OrderingCache, type OrderingFileV1, type RankRecord } from './types';

export const ORDERING_FILE_NAME = 'ordering.json';

function toRecord(arr: Array<{ id: string; ranks: RankRecord }>): Record<string, RankRecord> {
  const out: Record<string, RankRecord> = {};
  for (const { id, ranks } of arr) out[id] = ranks;
  return out;
}

function toArray(rec: Record<string, RankRecord>): Array<{ id: string; ranks: RankRecord }> {
  return Object.entries(rec)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, ranks]) => ({ id, ranks }));
}

function parse(txt: string): OrderingCache | null {
  try {
    const json = JSON.parse(txt) as OrderingFileV1;
    if (!json || json.v !== 1) return null;
    return {
      bookmarks:     toRecord(json.bookmarks ?? []),
      files:         toRecord(json.files ?? []),
      groups:        toRecord(json.groups ?? []),
      bookmarkFiles: toRecord(json.bookmarkFiles ?? []),
    };
  } catch {
    return null;
  }
}

/**
 * Load the ordering cache from `<cacheDir>/ordering.json`. Recovery order:
 *   1. main file parses → return it
 *   2. main missing → empty cache (silent)
 *   3. main corrupt, .bak parses → restore main from .bak, return parsed
 *   4. both corrupt → empty cache, log warning
 *
 * Mirrors the inline pattern in @agentic-bookmarks/core's store_v2.ts; kept
 * local because we don't need the lockfile/pulse machinery for a single-
 * process cache.
 */
export async function loadOrderingCache(cacheDir: string): Promise<OrderingCache> {
  const file = path.join(cacheDir, ORDERING_FILE_NAME);
  const bak  = file + '.bak';

  let mainTxt: string | null = null;
  try { mainTxt = await fs.readFile(file, 'utf8'); }
  catch (err: any) {
    if (err?.code === 'ENOENT') return emptyOrderingCache();
    // Read error other than ENOENT — fall through to bak attempt.
  }

  if (mainTxt != null) {
    const parsed = parse(mainTxt);
    if (parsed) return parsed;
  }

  // Try .bak.
  let bakTxt: string | null = null;
  try { bakTxt = await fs.readFile(bak, 'utf8'); } catch { /* no bak */ }
  if (bakTxt != null) {
    const parsed = parse(bakTxt);
    if (parsed) {
      try { await fs.copyFile(bak, file); } catch { /* best-effort restore */ }
      console.warn(`[ordering] Recovered ordering.json from .bak`);
      return parsed;
    }
  }

  console.warn(`[ordering] Both ordering.json and .bak unreadable — starting with empty cache`);
  return emptyOrderingCache();
}

export async function saveOrderingCache(cacheDir: string, cache: OrderingCache): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, ORDERING_FILE_NAME);
  const bak  = file + '.bak';

  // Backup current main file if it exists.
  try {
    await fs.access(file);
    await fs.copyFile(file, bak);
  } catch { /* no existing main — skip backup */ }

  const payload: OrderingFileV1 = {
    v: 1,
    bookmarks:     toArray(cache.bookmarks),
    files:         toArray(cache.files),
    groups:        toArray(cache.groups),
    bookmarkFiles: toArray(cache.bookmarkFiles),
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2), { mode: 0o644 });
}
