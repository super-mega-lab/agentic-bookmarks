import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { computeWorkspaceStats } from './settingsStats';
import { pathsForDataFile, type WorkspaceRegistryV1 } from '@agentic-bookmarks/core';

const now = Date.now();

function makeGroup(id: string, name: string, isUnsorted = false) {
  return { id, name, icon: {}, createdAt: now, isUnsorted };
}

function makeBookmark(id: string, groupId: string, fileId: string, uri: string, line = 0) {
  return { id, fileId, groupId, target: { uri }, anchor: { kind: 'point', line }, label: '', createdAt: now };
}

function makeV2File(opts: { fileId?: string; groups?: any[]; bookmarks?: any[] } = {}) {
  return {
    version: 2,
    fileId: opts.fileId || 'f1',
    groups: opts.groups || [makeGroup('g1', 'Default', true)],
    bookmarks: opts.bookmarks || [],
  };
}

function makeRegistry(files: WorkspaceRegistryV1['files'], dataRoot?: string): WorkspaceRegistryV1 {
  return {
    version: 1,
    files,
    settings: dataRoot ? { paths: { bookmarksDataRoot: dataRoot } } : undefined,
  } as WorkspaceRegistryV1;
}

describe('computeWorkspaceStats', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `bookmarks-stats-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch {}
  });

  async function writeDataFile(filePath: string, content: any, dataRoot?: string) {
    const p = pathsForDataFile(filePath, testDir, dataRoot);
    await fs.mkdir(path.dirname(p.data), { recursive: true });
    await fs.writeFile(p.data, JSON.stringify(content), 'utf8');
  }

  it('counts enabled files, groups, and bookmarks', async () => {
    const filePath = 'my-bookmarks.json';
    const v2 = makeV2File({
      groups: [
        makeGroup('g1', 'Group A'),
        makeGroup('g2', 'Group B'),
      ],
      bookmarks: [
        makeBookmark('b1', 'g1', 'f1', 'file:///a.ts', 0),
        makeBookmark('b2', 'g1', 'f1', 'file:///b.ts', 5),
        makeBookmark('b3', 'g2', 'f1', 'file:///c.ts', 10),
      ],
    });
    await writeDataFile(filePath, v2);

    const reg = makeRegistry([{ path: filePath } as any]);
    const stats = await computeWorkspaceStats(reg, testDir);

    expect(stats.files).toBe(1);
    expect(stats.groups).toBe(2);
    expect(stats.bookmarks).toBe(3);
  });

  it('skips disabled files', async () => {
    const filePath = 'disabled.json';
    const v2 = makeV2File({
      groups: [makeGroup('g1', 'G', true)],
      bookmarks: [makeBookmark('b1', 'g1', 'f1', 'file:///a.ts')],
    });
    await writeDataFile(filePath, v2);

    const reg = makeRegistry([{ path: filePath, enabled: false } as any]);
    const stats = await computeWorkspaceStats(reg, testDir);

    expect(stats.files).toBe(0);
    expect(stats.groups).toBe(0);
    expect(stats.bookmarks).toBe(0);
  });

  it('handles missing files without throwing', async () => {
    // readFileV2 creates a default empty file as last resort, so this counts as 1 file with 1 default group
    const reg = makeRegistry([{ path: 'nonexistent.json' } as any]);
    const stats = await computeWorkspaceStats(reg, testDir);

    expect(stats.files).toBe(1);
    expect(stats.groups).toBe(1);
    expect(stats.bookmarks).toBe(0);
  });

  it('supports custom bookmarksDataRoot', async () => {
    const customRoot = '.bookmarks/shared';
    const filePath = 'custom.json';
    const v2 = makeV2File({
      groups: [makeGroup('g1', 'Custom', true)],
      bookmarks: [makeBookmark('b1', 'g1', 'f1', 'file:///x.ts')],
    });
    await writeDataFile(filePath, v2, customRoot);

    const reg = makeRegistry([{ path: filePath } as any], customRoot);
    const stats = await computeWorkspaceStats(reg, testDir);

    expect(stats.files).toBe(1);
    expect(stats.groups).toBe(1);
    expect(stats.bookmarks).toBe(1);
  });

  it('aggregates across multiple files', async () => {
    const v2a = makeV2File({
      fileId: 'f1',
      groups: [makeGroup('g1', 'A', true)],
      bookmarks: [makeBookmark('b1', 'g1', 'f1', 'file:///a.ts')],
    });
    const v2b = makeV2File({
      fileId: 'f2',
      groups: [
        makeGroup('g2', 'B'),
        makeGroup('g3', 'C'),
      ],
      bookmarks: [
        makeBookmark('b2', 'g2', 'f2', 'file:///b.ts'),
        makeBookmark('b3', 'g3', 'f2', 'file:///c.ts'),
      ],
    });
    await writeDataFile('file-a.json', v2a);
    await writeDataFile('file-b.json', v2b);

    const reg = makeRegistry([
      { path: 'file-a.json' } as any,
      { path: 'file-b.json' } as any,
    ]);
    const stats = await computeWorkspaceStats(reg, testDir);

    expect(stats.files).toBe(2);
    expect(stats.groups).toBe(3);
    expect(stats.bookmarks).toBe(3);
  });
});
