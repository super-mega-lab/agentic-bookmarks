import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadOrderingCache, saveOrderingCache, ORDERING_FILE_NAME } from './store';
import { emptyOrderingCache, type OrderingCache } from './types';

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

describe('ordering store', () => {
  let dir: string;
  let file: string;
  let bak: string;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ord-')));
    file = path.join(dir, ORDERING_FILE_NAME);
    bak  = file + '.bak';
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('returns an empty cache when no file exists', async () => {
    const cache = await loadOrderingCache(dir);
    expect(cache).toEqual(emptyOrderingCache());
  });

  it('round-trips a non-empty cache', async () => {
    const cache: OrderingCache = {
      bookmarks: { 'B1': { f: 100, a: 200 } },
      files:     { 'F1': { a: 100 } },
      groups:    { 'G1': { f: 200 } },
      bookmarkFiles: { 'BF1': { f: 300 } },
    };
    await saveOrderingCache(dir, cache);
    const loaded = await loadOrderingCache(dir);
    expect(loaded).toEqual(cache);
  });

  it('writes a .bak copy of the previous file before each save', async () => {
    const c1: OrderingCache = { ...emptyOrderingCache(), bookmarks: { B: { a: 100 } } };
    const c2: OrderingCache = { ...emptyOrderingCache(), bookmarks: { B: { a: 200 } } };
    await saveOrderingCache(dir, c1);
    expect(await exists(bak)).toBe(false); // no bak before second write
    await saveOrderingCache(dir, c2);
    expect(await exists(bak)).toBe(true);
    const bakTxt = await fs.readFile(bak, 'utf8');
    expect(JSON.parse(bakTxt).bookmarks[0].ranks.a).toBe(100);
  });

  it('recovers from .bak when the main file is corrupt', async () => {
    const c: OrderingCache = { ...emptyOrderingCache(), bookmarks: { B: { a: 100 } } };
    await saveOrderingCache(dir, c);
    // First save wrote no bak (no prior file). Stage one manually, then corrupt main.
    await fs.copyFile(file, bak);
    await fs.writeFile(file, '{ this is not valid json', 'utf8');
    const loaded = await loadOrderingCache(dir);
    expect(loaded.bookmarks['B'].a).toBe(100);
    // Main file should also be restored from .bak.
    const restored = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(restored.bookmarks[0].ranks.a).toBe(100);
  });

  it('returns empty cache when both main and .bak are corrupt', async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, 'garbage', 'utf8');
    await fs.writeFile(bak, 'also garbage', 'utf8');
    const loaded = await loadOrderingCache(dir);
    expect(loaded).toEqual(emptyOrderingCache());
  });
});
