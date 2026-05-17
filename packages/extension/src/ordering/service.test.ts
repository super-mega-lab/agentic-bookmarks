import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OrderingService } from './service';
import { ORDERING_FILE_NAME } from './store';

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

describe('OrderingService', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'svc-')));
    vi.useFakeTimers();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('starts empty when no file exists', async () => {
    const svc = await OrderingService.load(dir);
    expect(svc.has('bookmark', 'X', 'a')).toBe(false);
    expect(svc.get('bookmark', 'X', 'a')).toBeUndefined();
  });

  it('set/get/has/delete work end-to-end', async () => {
    const svc = await OrderingService.load(dir);
    svc.set('bookmark', 'B1', 'f', 200);
    expect(svc.has('bookmark', 'B1', 'f')).toBe(true);
    expect(svc.get('bookmark', 'B1', 'f')).toBe(200);
    svc.delete('bookmark', 'B1', 'f');
    expect(svc.has('bookmark', 'B1', 'f')).toBe(false);
  });

  it('debounces writes — multiple sets within window result in one file', async () => {
    const svc = await OrderingService.load(dir);
    svc.set('bookmark', 'B1', 'f', 100);
    svc.set('bookmark', 'B2', 'f', 200);
    svc.set('bookmark', 'B3', 'f', 300);
    // No write yet.
    expect(await fileExists(path.join(dir, ORDERING_FILE_NAME))).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    // Timer fired; the resulting write is real I/O — await flush() to settle it.
    await svc.flush();
    expect(await fileExists(path.join(dir, ORDERING_FILE_NAME))).toBe(true);
    const txt = await fs.readFile(path.join(dir, ORDERING_FILE_NAME), 'utf8');
    const parsed = JSON.parse(txt);
    expect(parsed.bookmarks.length).toBe(3);
  });

  it('flush() persists pending writes synchronously', async () => {
    const svc = await OrderingService.load(dir);
    svc.set('group', 'G', 'f', 100);
    await svc.flush();
    expect(await fileExists(path.join(dir, ORDERING_FILE_NAME))).toBe(true);
  });

  it('dispose() flushes pending writes', async () => {
    const svc = await OrderingService.load(dir);
    svc.set('file', 'F', 'a', 100);
    await svc.dispose();
    expect(await fileExists(path.join(dir, ORDERING_FILE_NAME))).toBe(true);
  });

  it('load prunes unknown ids when a known-id set is provided', async () => {
    // Pre-seed a cache with 3 bookmarks, 2 known.
    const svc1 = await OrderingService.load(dir);
    svc1.set('bookmark', 'KEEP1', 'a', 100);
    svc1.set('bookmark', 'KEEP2', 'a', 200);
    svc1.set('bookmark', 'STALE', 'a', 300);
    await svc1.flush();

    const knownIds = {
      bookmarks: new Set(['KEEP1', 'KEEP2']),
      files: new Set<string>(),
      groups: new Set<string>(),
      bookmarkFiles: new Set<string>(),
    };
    const svc2 = await OrderingService.load(dir, knownIds);
    expect(svc2.has('bookmark', 'KEEP1', 'a')).toBe(true);
    expect(svc2.has('bookmark', 'KEEP2', 'a')).toBe(true);
    expect(svc2.has('bookmark', 'STALE', 'a')).toBe(false);
  });
});
