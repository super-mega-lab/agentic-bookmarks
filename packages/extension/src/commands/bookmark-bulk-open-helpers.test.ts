// ABOUTME: Tests for bookmark-bulk-open-helpers — pure file-collection helpers
// ABOUTME: that gather the unique set of bookmarked files for Open/Scan commands.

import { describe, it, expect } from 'vitest';
import type {
  BookmarksFileV2,
  WorkspaceRegistryV1,
} from '@agentic-bookmarks/core';
import {
  collectVisibleBookmarkedFiles,
  collectAllRegisteredBookmarkedFiles,
  type LoadedFile,
  type LoadedFolder,
} from './bookmark-bulk-open-helpers';
import type { Visibility } from './bookmark-quickpick-items';

const WS = '/ws';

function bookmark(overrides: Partial<{
  id: string;
  groupId: string;
  uri: string;
  anchor: any;
  label: string;
  note: string;
}>): any {
  return {
    id: overrides.id ?? 'b1',
    fileId: 'f1',
    groupId: overrides.groupId ?? 'gA',
    target: { uri: overrides.uri ?? 'src/foo.ts' },
    anchor: overrides.anchor ?? { kind: 'point', line: 0 },
    label: overrides.label ?? '',
    note: overrides.note ?? '',
    createdAt: 0,
    createdBy: 'test',
    source: 'test',
    tags: [],
  };
}

function makeFile(opts: {
  fileId: string;
  groups?: Array<{ id: string; name: string }>;
  bookmarks: any[];
}): BookmarksFileV2 {
  return {
    schemaVersion: 2,
    fileId: opts.fileId,
    defaultAnchorType: 'smart',
    groups: opts.groups ?? [{ id: 'gA', name: 'A' }],
    bookmarks: opts.bookmarks,
  } as any;
}

function makeLoadedFile(opts: {
  fileId: string;
  regPath: string;
  bookmarks: any[];
  groups?: Array<{ id: string; name: string }>;
  wsRoot?: string;
}): LoadedFile {
  return {
    wsRoot: opts.wsRoot ?? WS,
    dataRoot: '.bookmarks',
    regPath: opts.regPath,
    data: makeFile({
      fileId: opts.fileId,
      groups: opts.groups,
      bookmarks: opts.bookmarks,
    }),
  };
}

function makeRegistry(files: Array<{
  fileId: string;
  path: string;
  enabled?: boolean;
}>): WorkspaceRegistryV1 {
  return {
    version: 1,
    files: files.map((f) => ({
      fileId: f.fileId,
      path: f.path,
      ...(f.enabled !== undefined && { enabled: f.enabled }),
    })),
    nameIndex: {},
    settings: {
      watchersEnabled: true,
      sortByGroup: false,
      sortByFile: true,
      appearance: {
        showDifferentColors: true,
        showDifferentStyles: true,
      },
    },
  } as any;
}

function makeLoadedFolder(opts: {
  wsRoot?: string;
  files: Array<{ fileId: string; path: string; enabled?: boolean }>;
}): LoadedFolder {
  return {
    wsRoot: opts.wsRoot ?? WS,
    reg: makeRegistry(opts.files),
    dataRoot: '.bookmarks',
  };
}

const VISIBILITY_FILTER_OFF: Visibility = {
  hidden: [],
  focus: null,
  filterEnabled: false,
  searches: [],
};

describe('collectVisibleBookmarkedFiles', () => {
  it('returns empty array when filesData is empty', () => {
    const folders: LoadedFolder[] = [makeLoadedFolder({ files: [] })];
    const result = collectVisibleBookmarkedFiles({
      folders,
      filesData: [],
      visibility: VISIBILITY_FILTER_OFF,
      composedIsFileHidden: () => false,
    });
    expect(result).toEqual([]);
  });

  it('returns single target when one file has one bookmark', () => {
    const folders = [makeLoadedFolder({ files: [{ fileId: 'f1', path: 'meta1.json' }] })];
    const filesData = [
      makeLoadedFile({
        fileId: 'f1',
        regPath: 'meta1.json',
        bookmarks: [bookmark({ id: 'b1', uri: 'src/foo.ts' })],
      }),
    ];
    const result = collectVisibleBookmarkedFiles({
      folders,
      filesData,
      visibility: VISIBILITY_FILTER_OFF,
      composedIsFileHidden: () => false,
    });
    expect(result).toEqual([
      { fsPath: '/ws/src/foo.ts', relativePath: 'src/foo.ts' },
    ]);
  });

  it('dedupes multiple bookmarks in the same file to a single target', () => {
    const folders = [makeLoadedFolder({ files: [{ fileId: 'f1', path: 'meta1.json' }] })];
    const filesData = [
      makeLoadedFile({
        fileId: 'f1',
        regPath: 'meta1.json',
        bookmarks: [
          bookmark({ id: 'b1', uri: 'src/foo.ts', anchor: { kind: 'point', line: 0 } }),
          bookmark({ id: 'b2', uri: 'src/foo.ts', anchor: { kind: 'point', line: 5 } }),
          bookmark({ id: 'b3', uri: 'src/foo.ts', anchor: { kind: 'point', line: 9 } }),
        ],
      }),
    ];
    const result = collectVisibleBookmarkedFiles({
      folders,
      filesData,
      visibility: VISIBILITY_FILTER_OFF,
      composedIsFileHidden: () => false,
    });
    expect(result).toEqual([
      { fsPath: '/ws/src/foo.ts', relativePath: 'src/foo.ts' },
    ]);
  });

  it('sorts results by relativePath when bookmarks come from multiple files', () => {
    const folders = [
      makeLoadedFolder({
        files: [
          { fileId: 'f1', path: 'meta1.json' },
          { fileId: 'f2', path: 'meta2.json' },
          { fileId: 'f3', path: 'meta3.json' },
        ],
      }),
    ];
    const filesData = [
      makeLoadedFile({
        fileId: 'f1',
        regPath: 'meta1.json',
        bookmarks: [bookmark({ id: 'b1', uri: 'src/zebra.ts' })],
      }),
      makeLoadedFile({
        fileId: 'f2',
        regPath: 'meta2.json',
        bookmarks: [bookmark({ id: 'b2', uri: 'src/alpha.ts', groupId: 'gA' })],
      }),
      makeLoadedFile({
        fileId: 'f3',
        regPath: 'meta3.json',
        bookmarks: [bookmark({ id: 'b3', uri: 'src/middle.ts', groupId: 'gA' })],
      }),
    ];
    const result = collectVisibleBookmarkedFiles({
      folders,
      filesData,
      visibility: VISIBILITY_FILTER_OFF,
      composedIsFileHidden: () => false,
    });
    expect(result.map((r) => r.relativePath)).toEqual([
      'src/alpha.ts',
      'src/middle.ts',
      'src/zebra.ts',
    ]);
  });

  it('excludes files reported as hidden by composedIsFileHidden', () => {
    const folders = [
      makeLoadedFolder({
        files: [
          { fileId: 'fVisible', path: 'm1.json' },
          { fileId: 'fHidden', path: 'm2.json' },
        ],
      }),
    ];
    const filesData = [
      makeLoadedFile({
        fileId: 'fVisible',
        regPath: 'm1.json',
        bookmarks: [bookmark({ id: 'b1', uri: 'src/visible.ts' })],
      }),
      makeLoadedFile({
        fileId: 'fHidden',
        regPath: 'm2.json',
        bookmarks: [bookmark({ id: 'b2', uri: 'src/hidden.ts' })],
      }),
    ];
    const result = collectVisibleBookmarkedFiles({
      folders,
      filesData,
      visibility: VISIBILITY_FILTER_OFF,
      composedIsFileHidden: (fileId) => fileId === 'fHidden',
    });
    expect(result.map((r) => r.relativePath)).toEqual(['src/visible.ts']);
  });

  it('excludes bookmarks in hidden groups when filterEnabled is true', () => {
    const folders = [makeLoadedFolder({ files: [{ fileId: 'f1', path: 'meta1.json' }] })];
    const filesData = [
      makeLoadedFile({
        fileId: 'f1',
        regPath: 'meta1.json',
        groups: [
          { id: 'gA', name: 'A' },
          { id: 'gB', name: 'B' },
        ],
        bookmarks: [
          bookmark({ id: 'b1', uri: 'src/hidden-only.ts', groupId: 'gB' }),
        ],
      }),
    ];
    const result = collectVisibleBookmarkedFiles({
      folders,
      filesData,
      visibility: { hidden: ['gB'], focus: null, filterEnabled: true, searches: [] },
      composedIsFileHidden: () => false,
    });
    // The only bookmark in src/hidden-only.ts is in a hidden group → file excluded.
    expect(result).toEqual([]);
  });

  it('still includes files with hidden-group-only bookmarks when filterEnabled is false', () => {
    const folders = [makeLoadedFolder({ files: [{ fileId: 'f1', path: 'meta1.json' }] })];
    const filesData = [
      makeLoadedFile({
        fileId: 'f1',
        regPath: 'meta1.json',
        groups: [
          { id: 'gA', name: 'A' },
          { id: 'gB', name: 'B' },
        ],
        bookmarks: [bookmark({ id: 'b1', uri: 'src/foo.ts', groupId: 'gB' })],
      }),
    ];
    const result = collectVisibleBookmarkedFiles({
      folders,
      filesData,
      // filterEnabled: false → group-hide list is ignored
      visibility: { hidden: ['gB'], focus: null, filterEnabled: false, searches: [] },
      composedIsFileHidden: () => false,
    });
    expect(result).toEqual([
      { fsPath: '/ws/src/foo.ts', relativePath: 'src/foo.ts' },
    ]);
  });

  it('partial-visibility file (mix of visible and hidden group bookmarks) → file included once', () => {
    const folders = [makeLoadedFolder({ files: [{ fileId: 'f1', path: 'meta1.json' }] })];
    const filesData = [
      makeLoadedFile({
        fileId: 'f1',
        regPath: 'meta1.json',
        groups: [
          { id: 'gA', name: 'A' },
          { id: 'gB', name: 'B' },
        ],
        bookmarks: [
          bookmark({ id: 'b1', uri: 'src/foo.ts', groupId: 'gA' }),
          bookmark({ id: 'b2', uri: 'src/foo.ts', groupId: 'gB' }),
        ],
      }),
    ];
    const result = collectVisibleBookmarkedFiles({
      folders,
      filesData,
      visibility: { hidden: ['gB'], focus: null, filterEnabled: true, searches: [] },
      composedIsFileHidden: () => false,
    });
    expect(result).toEqual([
      { fsPath: '/ws/src/foo.ts', relativePath: 'src/foo.ts' },
    ]);
  });

  it('resolves file:// URIs to absolute fsPath and computes relativePath', () => {
    const folders = [makeLoadedFolder({ files: [{ fileId: 'f1', path: 'meta1.json' }] })];
    const filesData = [
      makeLoadedFile({
        fileId: 'f1',
        regPath: 'meta1.json',
        bookmarks: [bookmark({ id: 'b1', uri: 'file:///ws/src/bar.ts' })],
      }),
    ];
    const result = collectVisibleBookmarkedFiles({
      folders,
      filesData,
      visibility: VISIBILITY_FILTER_OFF,
      composedIsFileHidden: () => false,
    });
    expect(result).toEqual([
      { fsPath: '/ws/src/bar.ts', relativePath: 'src/bar.ts' },
    ]);
  });

  it('multi-root: bookmarked files from different workspace roots are all included, sorted globally', () => {
    const folders = [
      makeLoadedFolder({
        wsRoot: '/ws/a',
        files: [{ fileId: 'fA', path: 'meta.json' }],
      }),
      makeLoadedFolder({
        wsRoot: '/ws/b',
        files: [{ fileId: 'fB', path: 'meta.json' }],
      }),
    ];
    const filesData = [
      makeLoadedFile({
        wsRoot: '/ws/a',
        fileId: 'fA',
        regPath: 'meta.json',
        bookmarks: [bookmark({ id: 'b1', uri: 'src/zebra.ts' })],
      }),
      makeLoadedFile({
        wsRoot: '/ws/b',
        fileId: 'fB',
        regPath: 'meta.json',
        bookmarks: [bookmark({ id: 'b2', uri: 'src/alpha.ts' })],
      }),
    ];
    const result = collectVisibleBookmarkedFiles({
      folders,
      filesData,
      visibility: VISIBILITY_FILTER_OFF,
      composedIsFileHidden: () => false,
    });
    // Sorted by relativePath: alpha.ts < zebra.ts.
    expect(result.map((r) => r.relativePath)).toEqual([
      'src/alpha.ts',
      'src/zebra.ts',
    ]);
    expect(result.map((r) => r.fsPath)).toEqual([
      '/ws/b/src/alpha.ts',
      '/ws/a/src/zebra.ts',
    ]);
  });
});

describe('collectAllRegisteredBookmarkedFiles', () => {
  it('returns empty array when filesData is empty', () => {
    const folders = [makeLoadedFolder({ files: [] })];
    const result = collectAllRegisteredBookmarkedFiles({
      folders,
      filesData: [],
    });
    expect(result).toEqual([]);
  });

  it('includes file regardless of UI hide (no visibility input at all)', () => {
    // The function signature deliberately does not accept a `visibility` parameter.
    // The "Including Hidden" semantics mean we never consult UI visibility state.
    const folders = [
      makeLoadedFolder({
        files: [
          { fileId: 'f1', path: 'm1.json' },
          { fileId: 'f2', path: 'm2.json' },
        ],
      }),
    ];
    const filesData = [
      makeLoadedFile({
        fileId: 'f1',
        regPath: 'm1.json',
        groups: [{ id: 'gHidden', name: 'Hidden' }],
        bookmarks: [bookmark({ id: 'b1', uri: 'src/in-hidden-group.ts', groupId: 'gHidden' })],
      }),
      makeLoadedFile({
        fileId: 'f2',
        regPath: 'm2.json',
        bookmarks: [bookmark({ id: 'b2', uri: 'src/normal.ts' })],
      }),
    ];
    const result = collectAllRegisteredBookmarkedFiles({
      folders,
      filesData,
    });
    expect(result.map((r) => r.relativePath)).toEqual([
      'src/in-hidden-group.ts',
      'src/normal.ts',
    ]);
  });

  it('excludes files whose registry entry has enabled === false', () => {
    const folders = [
      makeLoadedFolder({
        files: [
          { fileId: 'fEnabled', path: 'm1.json' }, // enabled omitted → enabled
          { fileId: 'fDisabled', path: 'm2.json', enabled: false },
        ],
      }),
    ];
    const filesData = [
      makeLoadedFile({
        fileId: 'fEnabled',
        regPath: 'm1.json',
        bookmarks: [bookmark({ id: 'b1', uri: 'src/enabled.ts' })],
      }),
      makeLoadedFile({
        fileId: 'fDisabled',
        regPath: 'm2.json',
        bookmarks: [bookmark({ id: 'b2', uri: 'src/disabled.ts' })],
      }),
    ];
    const result = collectAllRegisteredBookmarkedFiles({
      folders,
      filesData,
    });
    expect(result.map((r) => r.relativePath)).toEqual(['src/enabled.ts']);
  });

  it('includes files where enabled === true (explicit)', () => {
    const folders = [
      makeLoadedFolder({
        files: [{ fileId: 'fExplicitlyEnabled', path: 'm.json', enabled: true }],
      }),
    ];
    const filesData = [
      makeLoadedFile({
        fileId: 'fExplicitlyEnabled',
        regPath: 'm.json',
        bookmarks: [bookmark({ id: 'b1', uri: 'src/foo.ts' })],
      }),
    ];
    const result = collectAllRegisteredBookmarkedFiles({
      folders,
      filesData,
    });
    expect(result).toEqual([{ fsPath: '/ws/src/foo.ts', relativePath: 'src/foo.ts' }]);
  });

  it('excludes files with zero bookmarks', () => {
    const folders = [
      makeLoadedFolder({
        files: [
          { fileId: 'fHasBookmarks', path: 'm1.json' },
          { fileId: 'fEmpty', path: 'm2.json' },
        ],
      }),
    ];
    const filesData = [
      makeLoadedFile({
        fileId: 'fHasBookmarks',
        regPath: 'm1.json',
        bookmarks: [bookmark({ id: 'b1', uri: 'src/has.ts' })],
      }),
      makeLoadedFile({
        fileId: 'fEmpty',
        regPath: 'm2.json',
        bookmarks: [],
      }),
    ];
    const result = collectAllRegisteredBookmarkedFiles({
      folders,
      filesData,
    });
    expect(result.map((r) => r.relativePath)).toEqual(['src/has.ts']);
  });

  it('dedupes multiple bookmarks in the same file', () => {
    const folders = [makeLoadedFolder({ files: [{ fileId: 'f1', path: 'm.json' }] })];
    const filesData = [
      makeLoadedFile({
        fileId: 'f1',
        regPath: 'm.json',
        bookmarks: [
          bookmark({ id: 'b1', uri: 'src/foo.ts' }),
          bookmark({ id: 'b2', uri: 'src/foo.ts' }),
        ],
      }),
    ];
    const result = collectAllRegisteredBookmarkedFiles({
      folders,
      filesData,
    });
    expect(result).toEqual([{ fsPath: '/ws/src/foo.ts', relativePath: 'src/foo.ts' }]);
  });

  it('sorts results by relativePath', () => {
    const folders = [
      makeLoadedFolder({
        files: [
          { fileId: 'f1', path: 'm1.json' },
          { fileId: 'f2', path: 'm2.json' },
          { fileId: 'f3', path: 'm3.json' },
        ],
      }),
    ];
    const filesData = [
      makeLoadedFile({
        fileId: 'f1',
        regPath: 'm1.json',
        bookmarks: [bookmark({ id: 'b1', uri: 'src/zebra.ts' })],
      }),
      makeLoadedFile({
        fileId: 'f2',
        regPath: 'm2.json',
        bookmarks: [bookmark({ id: 'b2', uri: 'src/alpha.ts' })],
      }),
      makeLoadedFile({
        fileId: 'f3',
        regPath: 'm3.json',
        bookmarks: [bookmark({ id: 'b3', uri: 'src/middle.ts' })],
      }),
    ];
    const result = collectAllRegisteredBookmarkedFiles({
      folders,
      filesData,
    });
    expect(result.map((r) => r.relativePath)).toEqual([
      'src/alpha.ts',
      'src/middle.ts',
      'src/zebra.ts',
    ]);
  });

  it('multi-root: each folder contributes its enabled files independently', () => {
    const folders = [
      makeLoadedFolder({
        wsRoot: '/ws/a',
        files: [
          { fileId: 'fA1', path: 'm.json' },
          { fileId: 'fA2', path: 'm2.json', enabled: false },
        ],
      }),
      makeLoadedFolder({
        wsRoot: '/ws/b',
        files: [{ fileId: 'fB', path: 'm.json' }],
      }),
    ];
    const filesData = [
      makeLoadedFile({
        wsRoot: '/ws/a',
        fileId: 'fA1',
        regPath: 'm.json',
        bookmarks: [bookmark({ id: 'b1', uri: 'src/in-a.ts' })],
      }),
      makeLoadedFile({
        wsRoot: '/ws/a',
        fileId: 'fA2',
        regPath: 'm2.json',
        bookmarks: [bookmark({ id: 'b2', uri: 'src/disabled-in-a.ts' })],
      }),
      makeLoadedFile({
        wsRoot: '/ws/b',
        fileId: 'fB',
        regPath: 'm.json',
        bookmarks: [bookmark({ id: 'b3', uri: 'src/in-b.ts' })],
      }),
    ];
    const result = collectAllRegisteredBookmarkedFiles({
      folders,
      filesData,
    });
    expect(result.map((r) => r.relativePath)).toEqual([
      'src/in-a.ts',
      'src/in-b.ts',
    ]);
  });

  it('resolves file:// URIs', () => {
    const folders = [makeLoadedFolder({ files: [{ fileId: 'f1', path: 'm.json' }] })];
    const filesData = [
      makeLoadedFile({
        fileId: 'f1',
        regPath: 'm.json',
        bookmarks: [bookmark({ id: 'b1', uri: 'file:///ws/src/abs.ts' })],
      }),
    ];
    const result = collectAllRegisteredBookmarkedFiles({
      folders,
      filesData,
    });
    expect(result).toEqual([{ fsPath: '/ws/src/abs.ts', relativePath: 'src/abs.ts' }]);
  });

  it('strips #fragment from target.uri when computing fsPath', () => {
    const folders = [makeLoadedFolder({ files: [{ fileId: 'f1', path: 'm.json' }] })];
    const filesData = [
      makeLoadedFile({
        fileId: 'f1',
        regPath: 'm.json',
        bookmarks: [bookmark({ id: 'b1', uri: 'src/foo.ts#L42' })],
      }),
    ];
    const result = collectAllRegisteredBookmarkedFiles({
      folders,
      filesData,
    });
    expect(result).toEqual([{ fsPath: '/ws/src/foo.ts', relativePath: 'src/foo.ts' }]);
  });
});
