// ABOUTME: Tests for moveBookmarkAcrossFiles — the transactional, destination-first
// ABOUTME: cross-file bookmark move helper (SML-1520). DI fakes, no vscode, no disk.

import { describe, it, expect } from 'vitest';
import type { BookmarksFileV2 } from '@agentic-bookmarks/core';
import { moveBookmarkAcrossFiles, type BookmarkFileEditors } from './group-management-helpers';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function bookmark(overrides: { id: string; groupId?: string }): any {
  return {
    id: overrides.id,
    fileId: 'fOriginal',
    groupId: overrides.groupId ?? 'gA',
    target: { uri: 'src/foo.ts' },
    anchor: { kind: 'point', line: 0 },
  } as any;
}

function makeFile(fileId: string, bookmarks: any[]): BookmarksFileV2 {
  return {
    schemaVersion: 2,
    fileId,
    groups: [],
    bookmarks,
  } as any;
}

// In-memory editors fake over a map keyed by `paths.key`. Records every IO call
// into `calls` (e.g. 'read:src', 'edit:dst') so tests can assert ordering, and
// supports injecting a throw on a specific edit key.
function makeEditors(
  filesByKey: Record<string, BookmarksFileV2>,
  opts: { throwOnEdit?: string } = {},
): { editors: BookmarkFileEditors; calls: string[] } {
  const calls: string[] = [];
  const editors: BookmarkFileEditors = {
    readFileV2: async (paths: any) => {
      calls.push(`read:${paths.key}`);
      return filesByKey[paths.key];
    },
    editFileV2: async (paths: any, mutate: (f: BookmarksFileV2) => void | Promise<void>) => {
      calls.push(`edit:${paths.key}`);
      if (opts.throwOnEdit === paths.key) {
        throw new Error('simulated destination write failure');
      }
      await mutate(filesByKey[paths.key]);
      return undefined;
    },
  };
  return { editors, calls };
}

// ---------------------------------------------------------------------------
// moveBookmarkAcrossFiles
// ---------------------------------------------------------------------------

describe('moveBookmarkAcrossFiles', () => {
  it('moves the bookmark to the destination then removes it from source', async () => {
    const src = makeFile('fSrc', [bookmark({ id: 'b1', groupId: 'gA' }), bookmark({ id: 'b2', groupId: 'gA' })]);
    const dst = makeFile('fDst', [bookmark({ id: 'b9' })]);
    const { editors, calls } = makeEditors({ src, dst });

    const result = await moveBookmarkAcrossFiles(editors, { key: 'src' }, { key: 'dst' }, 'b1', 'gB');

    expect(result).toBe(true);
    expect(src.bookmarks.map((b: any) => b.id)).toEqual(['b2']);
    expect(dst.bookmarks.map((b: any) => b.id)).toEqual(['b1', 'b9']);
    const moved = dst.bookmarks.find((b: any) => b.id === 'b1') as any;
    expect(moved.fileId).toBe('fDst');
    expect(moved.groupId).toBe('gB');
    expect(typeof moved.updatedAt).toBe('number');
    // Destination is written BEFORE the source removal.
    expect(calls).toEqual(['read:src', 'edit:dst', 'edit:src']);
  });

  it('does not lose the bookmark when the destination write fails (SML-1520)', async () => {
    const src = makeFile('fSrc', [bookmark({ id: 'b1' })]);
    const dst = makeFile('fDst', []);
    const { editors, calls } = makeEditors({ src, dst }, { throwOnEdit: 'dst' });

    await expect(
      moveBookmarkAcrossFiles(editors, { key: 'src' }, { key: 'dst' }, 'b1', 'gB'),
    ).rejects.toThrow(/destination write failure/);

    // No data loss: the source still contains b1 because it was never mutated.
    expect(src.bookmarks.map((b: any) => b.id)).toEqual(['b1']);
    // 'edit:src' never happened — the source removal is gated on the dest write resolving.
    expect(calls).toEqual(['read:src', 'edit:dst']);
  });

  it('returns false and writes nothing when the bookmark is not in source', async () => {
    const src = makeFile('fSrc', [bookmark({ id: 'b1' })]);
    const dst = makeFile('fDst', []);
    const { editors, calls } = makeEditors({ src, dst });

    const result = await moveBookmarkAcrossFiles(editors, { key: 'src' }, { key: 'dst' }, 'nope', 'gB');

    expect(result).toBe(false);
    expect(dst.bookmarks).toEqual([]);
    expect(src.bookmarks.map((b: any) => b.id)).toEqual(['b1']);
    expect(calls).toEqual(['read:src']);
  });
});
