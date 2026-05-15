// ABOUTME: Unit tests for buildBookmarkPickItems — covers visibility filtering, scope, anchor
// ABOUTME: kinds, sorting, fragment stripping, and workspace-relative path resolution.

import { describe, it, expect } from 'vitest';
import type { BookmarksFileV2, WorkspaceRegistryV1 } from '@agentic-bookmarks/core';
import { buildBookmarkPickItems, type Visibility } from './bookmark-quickpick-items';

const WS = '/ws';

function bookmark(overrides: Partial<{
  id: string;
  fileId: string;
  groupId: string;
  uri: string;
  anchor: any;
  label: string;
}> = {}): any {
  return {
    id: overrides.id ?? 'b1',
    fileId: overrides.fileId ?? 'f1',
    groupId: overrides.groupId ?? 'gA',
    target: { uri: overrides.uri ?? 'src/foo.ts' },
    anchor: overrides.anchor ?? { kind: 'point', line: 5 },
    label: overrides.label ?? '',
    createdAt: 0,
    createdBy: 'test',
    source: 'test',
    tags: [],
  };
}

function group(overrides: Partial<{ id: string; name: string }> = {}): any {
  return {
    id: overrides.id ?? 'gA',
    name: overrides.name ?? 'Group A',
  };
}

function file(
  overrides: Partial<{ fileId: string; groups: any[]; bookmarks: any[] }> = {}
): BookmarksFileV2 {
  return {
    schemaVersion: 2,
    fileId: overrides.fileId ?? 'f1',
    groups: overrides.groups ?? [
      group({ id: 'gA', name: 'Group A' }),
      group({ id: 'gB', name: 'Group B' }),
      group({ id: 'gC', name: 'Group C' }),
    ],
    bookmarks: overrides.bookmarks ?? [],
  } as any;
}

function registry(files: Array<{ fileId: string; path: string; enabled?: boolean }> = []): WorkspaceRegistryV1 {
  return {
    version: 1,
    files,
    nameIndex: {},
    settings: {
      watchersEnabled: true,
      sortByGroup: false,
      sortByFile: false,
      appearance: { showDifferentColors: true, showDifferentStyles: true },
    },
  } as any;
}

const visibilityOff: Visibility = { hidden: [], focus: null, filterEnabled: false };
const visibilityOn: Visibility = { hidden: [], focus: null, filterEnabled: true };

const passthroughResolveLine = (_id: string, _fsPath: string, fallback: number): number => fallback;
const noFileHidden = (_fileId: string): boolean => false;

describe('buildBookmarkPickItems', () => {
  it('returns [] for empty filesData (scope=inFile)', () => {
    const items = buildBookmarkPickItems({
      scope: 'inFile',
      activeFileFsPath: '/ws/src/foo.ts',
      visibility: visibilityOff,
      filesData: [],
      registry: registry(),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items).toEqual([]);
  });

  it('returns [] for empty filesData (scope=all)', () => {
    const items = buildBookmarkPickItems({
      scope: 'all',
      visibility: visibilityOff,
      filesData: [],
      registry: registry(),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items).toEqual([]);
  });

  it('returns [] when scope=inFile but activeFileFsPath is undefined', () => {
    const data = file({
      bookmarks: [bookmark({ id: 'b1', uri: 'src/foo.ts' })],
    });
    const items = buildBookmarkPickItems({
      scope: 'inFile',
      // activeFileFsPath omitted
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: '.bookmarks/shared/foo.bookmarks.json', data }],
      registry: registry([{ fileId: 'f1', path: '.bookmarks/shared/foo.bookmarks.json' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items).toEqual([]);
  });

  it('scope=inFile filters to bookmarks resolving to activeFileFsPath (workspace-relative URI)', () => {
    const data = file({
      bookmarks: [
        bookmark({ id: 'b-match', uri: 'src/foo.ts', anchor: { kind: 'point', line: 3 } }),
        bookmark({ id: 'b-other', uri: 'src/bar.ts', anchor: { kind: 'point', line: 4 } }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'inFile',
      activeFileFsPath: '/ws/src/foo.ts',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items.map(i => i.bookmarkId)).toEqual(['b-match']);
  });

  it('scope=inFile matches bookmarks with file:// URI form', () => {
    const data = file({
      bookmarks: [
        bookmark({ id: 'b1', uri: 'file:///ws/src/foo.ts', anchor: { kind: 'point', line: 7 } }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'inFile',
      activeFileFsPath: '/ws/src/foo.ts',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items.map(i => i.bookmarkId)).toEqual(['b1']);
  });

  it('scope=inFile strips #fragment from target.uri before comparison', () => {
    const data = file({
      bookmarks: [
        bookmark({ id: 'b1', uri: 'src/foo.ts#someTag', anchor: { kind: 'point', line: 2 } }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'inFile',
      activeFileFsPath: '/ws/src/foo.ts',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items.map(i => i.bookmarkId)).toEqual(['b1']);
  });

  it('scope=all aggregates bookmarks across multiple files', () => {
    const dataA = file({
      fileId: 'f1',
      bookmarks: [
        bookmark({ id: 'a1', fileId: 'f1', uri: 'src/foo.ts', anchor: { kind: 'point', line: 1 } }),
      ],
    });
    const dataB = file({
      fileId: 'f2',
      bookmarks: [
        bookmark({ id: 'b1', fileId: 'f2', uri: 'src/bar.ts', anchor: { kind: 'point', line: 2 } }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'all',
      visibility: visibilityOff,
      filesData: [
        { wsRoot: WS, regPath: 'pA', data: dataA },
        { wsRoot: WS, regPath: 'pB', data: dataB },
      ],
      registry: registry([
        { fileId: 'f1', path: 'pA' },
        { fileId: 'f2', path: 'pB' },
      ]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items.map(i => i.bookmarkId).sort()).toEqual(['a1', 'b1']);
  });

  it('scope=all sorts by (relativePath localeCompare, line ascending)', () => {
    const dataA = file({
      fileId: 'f1',
      bookmarks: [
        bookmark({ id: 'a-late', fileId: 'f1', uri: 'src/zeta.ts', anchor: { kind: 'point', line: 10 } }),
        bookmark({ id: 'a-early', fileId: 'f1', uri: 'src/zeta.ts', anchor: { kind: 'point', line: 1 } }),
      ],
    });
    const dataB = file({
      fileId: 'f2',
      bookmarks: [
        bookmark({ id: 'b1', fileId: 'f2', uri: 'src/alpha.ts', anchor: { kind: 'point', line: 5 } }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'all',
      visibility: visibilityOff,
      filesData: [
        { wsRoot: WS, regPath: 'pA', data: dataA },
        { wsRoot: WS, regPath: 'pB', data: dataB },
      ],
      registry: registry([
        { fileId: 'f1', path: 'pA' },
        { fileId: 'f2', path: 'pB' },
      ]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items.map(i => i.bookmarkId)).toEqual(['b1', 'a-early', 'a-late']);
  });

  it('scope=inFile sorts by line ascending', () => {
    const data = file({
      bookmarks: [
        bookmark({ id: 'late', uri: 'src/foo.ts', anchor: { kind: 'point', line: 20 } }),
        bookmark({ id: 'mid', uri: 'src/foo.ts', anchor: { kind: 'point', line: 10 } }),
        bookmark({ id: 'early', uri: 'src/foo.ts', anchor: { kind: 'point', line: 2 } }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'inFile',
      activeFileFsPath: '/ws/src/foo.ts',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items.map(i => i.bookmarkId)).toEqual(['early', 'mid', 'late']);
  });

  describe('visibility filter', () => {
    it('filterEnabled=true with hidden including the bookmarks groupId omits the bookmark', () => {
      const data = file({
        bookmarks: [
          bookmark({ id: 'b-hidden', groupId: 'gA' }),
          bookmark({ id: 'b-visible', groupId: 'gB' }),
        ],
      });
      const items = buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath: '/ws/src/foo.ts',
        visibility: { hidden: ['gA'], focus: null, filterEnabled: true },
        filesData: [{ wsRoot: WS, regPath: 'p', data }],
        registry: registry([{ fileId: 'f1', path: 'p' }]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      expect(items.map(i => i.bookmarkId)).toEqual(['b-visible']);
    });

    it('filterEnabled=false ignores hidden list', () => {
      const data = file({
        bookmarks: [
          bookmark({ id: 'b1', groupId: 'gA' }),
          bookmark({ id: 'b2', groupId: 'gB' }),
        ],
      });
      const items = buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath: '/ws/src/foo.ts',
        visibility: { hidden: ['gA', 'gB'], focus: null, filterEnabled: false },
        filesData: [{ wsRoot: WS, regPath: 'p', data }],
        registry: registry([{ fileId: 'f1', path: 'p' }]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      expect(items.map(i => i.bookmarkId).sort()).toEqual(['b1', 'b2']);
    });

    it('focus set, bookmark in focused group, filterEnabled=true → included', () => {
      const data = file({
        bookmarks: [bookmark({ id: 'b1', groupId: 'gA' })],
      });
      const items = buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath: '/ws/src/foo.ts',
        visibility: { hidden: [], focus: 'gA', filterEnabled: true },
        filesData: [{ wsRoot: WS, regPath: 'p', data }],
        registry: registry([{ fileId: 'f1', path: 'p' }]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      expect(items.map(i => i.bookmarkId)).toEqual(['b1']);
    });

    it('focus set, bookmark in different group, filterEnabled=true → omitted', () => {
      const data = file({
        bookmarks: [
          bookmark({ id: 'b-focused', groupId: 'gA' }),
          bookmark({ id: 'b-other', groupId: 'gB' }),
        ],
      });
      const items = buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath: '/ws/src/foo.ts',
        visibility: { hidden: [], focus: 'gA', filterEnabled: true },
        filesData: [{ wsRoot: WS, regPath: 'p', data }],
        registry: registry([{ fileId: 'f1', path: 'p' }]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      expect(items.map(i => i.bookmarkId)).toEqual(['b-focused']);
    });

    it('focus set, filterEnabled=false → all bookmarks included', () => {
      const data = file({
        bookmarks: [
          bookmark({ id: 'b1', groupId: 'gA' }),
          bookmark({ id: 'b2', groupId: 'gB' }),
        ],
      });
      const items = buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath: '/ws/src/foo.ts',
        visibility: { hidden: [], focus: 'gA', filterEnabled: false },
        filesData: [{ wsRoot: WS, regPath: 'p', data }],
        registry: registry([{ fileId: 'f1', path: 'p' }]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      expect(items.map(i => i.bookmarkId).sort()).toEqual(['b1', 'b2']);
    });

    it('focus set + focused group also in hidden, filterEnabled=true → focus wins (included)', () => {
      const data = file({
        bookmarks: [
          bookmark({ id: 'b1', groupId: 'gA' }),
          bookmark({ id: 'b2', groupId: 'gB' }),
        ],
      });
      const items = buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath: '/ws/src/foo.ts',
        visibility: { hidden: ['gA'], focus: 'gA', filterEnabled: true },
        filesData: [{ wsRoot: WS, regPath: 'p', data }],
        registry: registry([{ fileId: 'f1', path: 'p' }]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      expect(items.map(i => i.bookmarkId)).toEqual(['b1']);
    });
  });

  it('isFileHidden returning true skips the entire file', () => {
    const dataA = file({
      fileId: 'f1',
      bookmarks: [
        bookmark({ id: 'a1', fileId: 'f1', uri: 'src/foo.ts' }),
      ],
    });
    const dataB = file({
      fileId: 'f2',
      bookmarks: [
        bookmark({ id: 'b1', fileId: 'f2', uri: 'src/bar.ts' }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'all',
      visibility: visibilityOff,
      filesData: [
        { wsRoot: WS, regPath: 'pA', data: dataA },
        { wsRoot: WS, regPath: 'pB', data: dataB },
      ],
      registry: registry([
        { fileId: 'f1', path: 'pA' },
        { fileId: 'f2', path: 'pB' },
      ]),
      isFileHidden: (id: string) => id === 'f1',
      resolveLine: passthroughResolveLine,
    });
    expect(items.map(i => i.bookmarkId)).toEqual(['b1']);
  });

  describe('anchor kinds', () => {
    it('point → line=endLine=anchor.line', () => {
      const data = file({
        bookmarks: [bookmark({ id: 'b1', anchor: { kind: 'point', line: 7 } })],
      });
      const items = buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath: '/ws/src/foo.ts',
        visibility: visibilityOff,
        filesData: [{ wsRoot: WS, regPath: 'p', data }],
        registry: registry([{ fileId: 'f1', path: 'p' }]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      expect(items[0].line).toBe(7);
      expect(items[0].endLine).toBe(7);
    });

    it('range → line=start.line, endLine=end.line', () => {
      const data = file({
        bookmarks: [
          bookmark({
            id: 'b1',
            anchor: { kind: 'range', start: { line: 5 }, end: { line: 12 } },
          }),
        ],
      });
      const items = buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath: '/ws/src/foo.ts',
        visibility: visibilityOff,
        filesData: [{ wsRoot: WS, regPath: 'p', data }],
        registry: registry([{ fileId: 'f1', path: 'p' }]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      expect(items[0].line).toBe(5);
      expect(items[0].endLine).toBe(12);
    });

    it('smart → line=endLine=lastUpdatedLine', () => {
      const data = file({
        bookmarks: [
          bookmark({
            id: 'b1',
            anchor: {
              kind: 'smart',
              lineCache: '',
              contextBefore: [],
              contextAfter: [],
              lastUpdatedLine: 9,
              nonce: 0,
            },
          }),
        ],
      });
      const items = buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath: '/ws/src/foo.ts',
        visibility: visibilityOff,
        filesData: [{ wsRoot: WS, regPath: 'p', data }],
        registry: registry([{ fileId: 'f1', path: 'p' }]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      expect(items[0].line).toBe(9);
      expect(items[0].endLine).toBe(9);
    });

    it('tag → line=endLine=lastUpdatedLine', () => {
      const data = file({
        bookmarks: [
          bookmark({
            id: 'b1',
            anchor: { kind: 'tag', tagId: 'X', lastUpdatedLine: 11, nonce: 0 },
          }),
        ],
      });
      const items = buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath: '/ws/src/foo.ts',
        visibility: visibilityOff,
        filesData: [{ wsRoot: WS, regPath: 'p', data }],
        registry: registry([{ fileId: 'f1', path: 'p' }]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      expect(items[0].line).toBe(11);
      expect(items[0].endLine).toBe(11);
    });
  });

  it('resolveLine override applies to non-range bookmarks (line and endLine both updated)', () => {
    const data = file({
      bookmarks: [
        bookmark({
          id: 'b1',
          anchor: {
            kind: 'smart',
            lineCache: '',
            contextBefore: [],
            contextAfter: [],
            lastUpdatedLine: 10,
            nonce: 0,
          },
        }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'inFile',
      activeFileFsPath: '/ws/src/foo.ts',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: (_id, _uri, _fb) => 42,
    });
    expect(items[0].line).toBe(42);
    expect(items[0].endLine).toBe(42);
  });

  it('range anchor preserves endLine even when resolveLine overrides line', () => {
    const data = file({
      bookmarks: [
        bookmark({
          id: 'b1',
          anchor: { kind: 'range', start: { line: 5 }, end: { line: 12 } },
        }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'inFile',
      activeFileFsPath: '/ws/src/foo.ts',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: (_id, _uri, _fb) => 99,
    });
    expect(items[0].line).toBe(99);
    expect(items[0].endLine).toBe(12);
  });

  it('empty bookmark label produces label: "" — no Ln N fallback in helper', () => {
    const data = file({
      bookmarks: [bookmark({ id: 'b1', label: '', anchor: { kind: 'point', line: 4 } })],
    });
    const items = buildBookmarkPickItems({
      scope: 'inFile',
      activeFileFsPath: '/ws/src/foo.ts',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items[0].label).toBe('');
  });

  it('group missing from data.groups → groupName: "(unknown)"', () => {
    const data = file({
      groups: [], // no groups defined
      bookmarks: [bookmark({ id: 'b1', groupId: 'gMissing' })],
    });
    const items = buildBookmarkPickItems({
      scope: 'inFile',
      activeFileFsPath: '/ws/src/foo.ts',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items[0].groupName).toBe('(unknown)');
  });

  it('relativePath computed from file:// URI inside workspace', () => {
    const data = file({
      bookmarks: [
        bookmark({ id: 'b1', uri: 'file:///ws/inside/workspace.ts', anchor: { kind: 'point', line: 0 } }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'all',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items[0].relativePath).toBe('inside/workspace.ts');
  });

  it('outside-workspace file:// URI → relativePath falls back to fsPath', () => {
    const data = file({
      bookmarks: [
        bookmark({ id: 'b1', uri: 'file:///elsewhere/other.ts', anchor: { kind: 'point', line: 0 } }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'all',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items[0].relativePath).toBe('/elsewhere/other.ts');
  });

  it('relativePath uses POSIX-style forward-slash separators', () => {
    const data = file({
      bookmarks: [
        bookmark({ id: 'b1', uri: 'file:///ws/src/nested/dir/file.ts', anchor: { kind: 'point', line: 0 } }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'all',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items[0].relativePath).toBe('src/nested/dir/file.ts');
    expect(items[0].relativePath).not.toContain('\\');
  });

  it('preserves workspace-relative target.uri as relativePath (sans fragment)', () => {
    const data = file({
      bookmarks: [
        bookmark({ id: 'b1', uri: 'src/foo.ts#frag', anchor: { kind: 'point', line: 0 } }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'all',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items[0].relativePath).toBe('src/foo.ts');
  });

  it('produces all expected fields on a complete item', () => {
    const data = file({
      fileId: 'fileX',
      groups: [group({ id: 'gA', name: 'My Group' })],
      bookmarks: [
        bookmark({
          id: 'bk1',
          fileId: 'fileX',
          groupId: 'gA',
          uri: 'src/foo.ts',
          anchor: { kind: 'point', line: 4 },
          label: 'My Note',
        }),
      ],
    });
    const items = buildBookmarkPickItems({
      scope: 'inFile',
      activeFileFsPath: '/ws/src/foo.ts',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data }],
      registry: registry([{ fileId: 'fileX', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      bookmarkId: 'bk1',
      fileId: 'fileX',
      groupId: 'gA',
      fsPath: '/ws/src/foo.ts',
      line: 4,
      endLine: 4,
      label: 'My Note',
      groupName: 'My Group',
      relativePath: 'src/foo.ts',
      note: '',
    });
  });

  it("propagates bookmark.note to item.note (and defaults to '' when absent)", () => {
    const dataWithNote = file({
      bookmarks: [
        { ...bookmark({ id: 'b-noted', uri: 'src/foo.ts' }), note: 'hello world' },
      ],
    });
    const itemsWithNote = buildBookmarkPickItems({
      scope: 'inFile',
      activeFileFsPath: '/ws/src/foo.ts',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data: dataWithNote }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(itemsWithNote).toHaveLength(1);
    expect(itemsWithNote[0].note).toBe('hello world');

    // bookmark() helper omits `note`, so b.note is undefined → item.note = ''
    const dataNoNote = file({
      bookmarks: [bookmark({ id: 'b-bare', uri: 'src/foo.ts' })],
    });
    const itemsNoNote = buildBookmarkPickItems({
      scope: 'inFile',
      activeFileFsPath: '/ws/src/foo.ts',
      visibility: visibilityOff,
      filesData: [{ wsRoot: WS, regPath: 'p', data: dataNoNote }],
      registry: registry([{ fileId: 'f1', path: 'p' }]),
      isFileHidden: noFileHidden,
      resolveLine: passthroughResolveLine,
    });
    expect(itemsNoNote).toHaveLength(1);
    expect(itemsNoNote[0].note).toBe('');
  });

  describe('search filter (ui.searches)', () => {
    const mkBookmarks = () => [
      bookmark({ id: 'b-todo', label: 'TODO refactor', anchor: { kind: 'point', line: 1 } }),
      bookmark({ id: 'b-fixme', label: 'FIXME crash bug', anchor: { kind: 'point', line: 2 } }),
      bookmark({ id: 'b-other', label: 'Note about API', anchor: { kind: 'point', line: 3 } }),
    ];
    const dataAll = () => file({ bookmarks: mkBookmarks() });
    const callWith = (visibility: Visibility) =>
      buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath: '/ws/src/foo.ts',
        visibility,
        filesData: [{ wsRoot: WS, regPath: 'p', data: dataAll() }],
        registry: registry([{ fileId: 'f1', path: 'p' }]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });

    it('returns all when searches is empty', () => {
      const items = callWith({ ...visibilityOn, searches: [] });
      expect(items.map(i => i.bookmarkId)).toEqual(['b-todo', 'b-fixme', 'b-other']);
    });

    it('AND narrows: bookmark must match every AND term', () => {
      const items = callWith({
        ...visibilityOn,
        searches: [{ id: 's1', text: 'crash', regex: false, op: 'AND' }],
      });
      expect(items.map(i => i.bookmarkId)).toEqual(['b-fixme']);
    });

    it('AND with multiple terms: all must match', () => {
      const items = callWith({
        ...visibilityOn,
        searches: [
          { id: 's1', text: 'crash', regex: false, op: 'AND' },
          { id: 's2', text: 'fixme', regex: false, op: 'AND' },
        ],
      });
      expect(items.map(i => i.bookmarkId)).toEqual(['b-fixme']);
    });

    it('AND with no match: empty result', () => {
      const items = callWith({
        ...visibilityOn,
        searches: [{ id: 's1', text: 'zzznomatch', regex: false, op: 'AND' }],
      });
      expect(items).toEqual([]);
    });

    it('OR widens: bookmark must match at least one OR term', () => {
      const items = callWith({
        ...visibilityOn,
        searches: [
          { id: 's1', text: 'TODO', regex: false, op: 'OR' },
          { id: 's2', text: 'FIXME', regex: false, op: 'OR' },
        ],
      });
      expect(items.map(i => i.bookmarkId).sort()).toEqual(['b-fixme', 'b-todo']);
    });

    it('AND combined with OR: andOk && (ors empty || ors.some)', () => {
      // AND "API" must match; OR ["TODO", "FIXME"] would match the others but
      // none satisfy AND. Result: empty.
      const items = callWith({
        ...visibilityOn,
        searches: [
          { id: 's1', text: 'API', regex: false, op: 'AND' },
          { id: 's2', text: 'TODO', regex: false, op: 'OR' },
          { id: 's3', text: 'FIXME', regex: false, op: 'OR' },
        ],
      });
      // Only b-other matches AND "API"; OR [TODO, FIXME] does not match it.
      expect(items).toEqual([]);
    });

    it('regex flag is honored (case-insensitive)', () => {
      const items = callWith({
        ...visibilityOn,
        searches: [{ id: 's1', text: '^todo|^fixme', regex: true, op: 'AND' }],
      });
      expect(items.map(i => i.bookmarkId).sort()).toEqual(['b-fixme', 'b-todo']);
    });

    it('regex parse failure short-circuits to no-match (does not throw)', () => {
      const items = callWith({
        ...visibilityOn,
        searches: [{ id: 's1', text: '[unterminated', regex: true, op: 'AND' }],
      });
      expect(items).toEqual([]);
    });

    it('regex matches against anchor.lineCache when present', () => {
      const data = file({
        bookmarks: [
          bookmark({
            id: 'b-cache',
            uri: 'src/foo.ts',
            anchor: { kind: 'smart', lastUpdatedLine: 0, lineCache: 'console.log("hello world")' } as any,
            label: '',
          }),
          bookmark({
            id: 'b-no-cache',
            uri: 'src/foo.ts',
            anchor: { kind: 'point', line: 1 },
            label: '',
          }),
        ],
      });
      const items = buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath: '/ws/src/foo.ts',
        visibility: {
          ...visibilityOn,
          searches: [{ id: 's1', text: 'hello\\s+world', regex: true, op: 'AND' }],
        },
        filesData: [{ wsRoot: WS, regPath: 'p', data }],
        registry: registry([{ fileId: 'f1', path: 'p' }]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      expect(items.map(i => i.bookmarkId)).toEqual(['b-cache']);
    });

    it('searches ignored when filterEnabled=false (mirrors treeProvider)', () => {
      const items = callWith({
        ...visibilityOff,
        searches: [{ id: 's1', text: 'zzznomatch', regex: false, op: 'AND' }],
      });
      expect(items.map(i => i.bookmarkId)).toEqual(['b-todo', 'b-fixme', 'b-other']);
    });
  });

  describe('multi-root (per-file wsRoot)', () => {
    it('resolves each bookmark against its own wsRoot, not a single global root', () => {
      const dataA = file({
        fileId: 'fA',
        bookmarks: [
          bookmark({ id: 'a1', fileId: 'fA', uri: 'src/foo.ts', anchor: { kind: 'point', line: 1 } }),
        ],
      });
      const dataB = file({
        fileId: 'fB',
        bookmarks: [
          bookmark({ id: 'b1', fileId: 'fB', uri: 'src/foo.ts', anchor: { kind: 'point', line: 2 } }),
        ],
      });
      const items = buildBookmarkPickItems({
        scope: 'all',
        visibility: visibilityOff,
        filesData: [
          { wsRoot: '/folderA', regPath: 'pA', data: dataA },
          { wsRoot: '/folderB', regPath: 'pB', data: dataB },
        ],
        registry: registry([
          { fileId: 'fA', path: 'pA' },
          { fileId: 'fB', path: 'pB' },
        ]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      const byId = new Map(items.map(i => [i.bookmarkId, i]));
      expect(byId.get('a1')?.fsPath).toBe('/folderA/src/foo.ts');
      expect(byId.get('b1')?.fsPath).toBe('/folderB/src/foo.ts');
      expect(byId.get('a1')?.relativePath).toBe('src/foo.ts');
      expect(byId.get('b1')?.relativePath).toBe('src/foo.ts');
    });

    it('scope=inFile filter compares fsPath against activeFileFsPath across roots', () => {
      const dataA = file({
        fileId: 'fA',
        bookmarks: [
          bookmark({ id: 'a-active', fileId: 'fA', uri: 'src/active.ts', anchor: { kind: 'point', line: 1 } }),
        ],
      });
      const dataB = file({
        fileId: 'fB',
        bookmarks: [
          // Same workspace-relative path 'src/active.ts' but different root —
          // must NOT match the active file (which is in folderA).
          bookmark({ id: 'b-collision', fileId: 'fB', uri: 'src/active.ts', anchor: { kind: 'point', line: 2 } }),
        ],
      });
      const items = buildBookmarkPickItems({
        scope: 'inFile',
        activeFileFsPath: '/folderA/src/active.ts',
        visibility: visibilityOff,
        filesData: [
          { wsRoot: '/folderA', regPath: 'pA', data: dataA },
          { wsRoot: '/folderB', regPath: 'pB', data: dataB },
        ],
        registry: registry([
          { fileId: 'fA', path: 'pA' },
          { fileId: 'fB', path: 'pB' },
        ]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      expect(items.map(i => i.bookmarkId)).toEqual(['a-active']);
    });
  });

  describe('robustness', () => {
    it('tolerates missing data.bookmarks (empty / undefined)', () => {
      const data = { schemaVersion: 2, fileId: 'f1', groups: [], bookmarks: undefined } as any;
      const items = buildBookmarkPickItems({
        scope: 'all',
        visibility: visibilityOff,
        filesData: [{ wsRoot: WS, regPath: 'p', data }],
        registry: registry([{ fileId: 'f1', path: 'p' }]),
        isFileHidden: noFileHidden,
        resolveLine: passthroughResolveLine,
      });
      expect(items).toEqual([]);
    });
  });
});
