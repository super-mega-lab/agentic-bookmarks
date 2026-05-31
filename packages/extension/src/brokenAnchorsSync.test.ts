// ABOUTME: Tests for the brokenAnchorsSync universe helper — collectBookmarkedUris builds
// ABOUTME: the live set of bookmarked target URIs used to prune coveredUris (SML-1509).
import { describe, it, expect } from 'vitest';
import type { WorkspaceRegistryV1 } from '@agentic-bookmarks/core';
import { collectBookmarkedUris } from './brokenAnchorsSync';

function makeRegistry(files: Array<{ fileId: string; path: string; enabled?: boolean }>): WorkspaceRegistryV1 {
  return {
    schemaVersion: 1,
    workspaceId: 'ws1',
    files,
    settings: { paths: { bookmarksDataRoot: '.bookmarks' } },
    ui: {},
  } as any;
}

// Fake the three core readers collectBookmarkedUris depends on, mirroring the DI
// test style used by bookmark-jump-helpers.test.ts. `throwOn` simulates a data file
// that fails to read (the load-error path).
function makeReaders(
  bookmarksByPath: Record<string, string[]>,
  throwOn: string[] = [],
) {
  return {
    getBookmarksDataRoot: () => '.bookmarks',
    pathsForDataFile: (filePath: string) => ({ data: filePath }) as any,
    readFileV2: async (paths: any) => {
      if (throwOn.includes(paths.data)) throw new Error('simulated read failure');
      const uris = bookmarksByPath[paths.data] ?? [];
      return {
        schemaVersion: 2,
        fileId: 'x',
        groups: [],
        bookmarks: uris.map((uri, i) => ({ id: `b${i}`, target: { uri } })),
      } as any;
    },
  };
}

describe('collectBookmarkedUris', () => {
  it('collects fragment-stripped target URIs from enabled files only', async () => {
    const reg = makeRegistry([
      { fileId: 'F1', path: '.bookmarks/shared/a.json' },
      { fileId: 'F2', path: '.bookmarks/local/b.json', enabled: false },
    ]);
    const readers = makeReaders({
      '.bookmarks/shared/a.json': ['src/a.ts#L5', 'src/b.ts', 'src/a.ts#L9'],
      '.bookmarks/local/b.json': ['src/only-in-disabled-file.ts'],
    });
    const { uris, reliable } = await collectBookmarkedUris('/ws', reg, readers);
    expect(reliable).toBe(true);
    // a.ts appears twice with different fragments → one normalized entry; disabled file excluded.
    expect([...uris].sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('marks universe unreliable when a data file fails to read (but keeps readable files)', async () => {
    const reg = makeRegistry([
      { fileId: 'F1', path: '.bookmarks/shared/a.json' },
      { fileId: 'F2', path: '.bookmarks/shared/c.json' },
    ]);
    const readers = makeReaders(
      { '.bookmarks/shared/a.json': ['src/a.ts'] },
      ['.bookmarks/shared/c.json'],
    );
    const { uris, reliable } = await collectBookmarkedUris('/ws', reg, readers);
    expect(reliable).toBe(false);
    expect([...uris]).toEqual(['src/a.ts']);
  });

  it('empty registry yields an empty, reliable universe', async () => {
    const { uris, reliable } = await collectBookmarkedUris('/ws', makeRegistry([]), makeReaders({}));
    expect(reliable).toBe(true);
    expect(uris.size).toBe(0);
  });
});
