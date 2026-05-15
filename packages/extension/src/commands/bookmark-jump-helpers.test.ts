// ABOUTME: Tests for bookmark-jump pure helpers — pickJumpTarget, collectVisibleBookmarks,
// ABOUTME: and mapRevealType. No vscode mocks; helpers are vscode-API-free by design.

import { describe, it, expect } from 'vitest';
import type { BookmarksFileV2, WorkspaceRegistryV1 } from '@agentic-bookmarks/core';
import {
  pickJumpTarget,
  mapRevealType,
  collectVisibleBookmarks,
  type VisibleBookmark,
  type CursorPosition,
  type UIStateForJump,
} from './bookmark-jump-helpers';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function vb(overrides: Partial<VisibleBookmark> & { fileFsPath: string; line: number }): VisibleBookmark {
  return {
    bookmarkId: overrides.bookmarkId ?? 'b',
    fileFsPath: overrides.fileFsPath,
    fileAbsoluteUri: overrides.fileAbsoluteUri ?? `file://${overrides.fileFsPath}`,
    line: overrides.line,
    workspaceRoot: overrides.workspaceRoot ?? '/ws',
    dataFilePath: overrides.dataFilePath ?? 'shared/team.bookmarks.json',
    groupId: overrides.groupId ?? 'gA',
  };
}

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
    anchor: overrides.anchor ?? { kind: 'point', line: 5 },
    label: overrides.label ?? '',
    note: overrides.note,
    createdAt: 0,
    createdBy: 'test',
    source: 'test',
    tags: [],
  };
}

function makeFile(bookmarks: any[]): BookmarksFileV2 {
  return {
    schemaVersion: 2,
    fileId: 'f1',
    groups: [
      { id: 'gA', name: 'A' },
      { id: 'gB', name: 'B' },
      { id: 'gC', name: 'C' },
    ],
    bookmarks,
  } as any;
}

function makeRegistry(files: Array<{ fileId: string; path: string; enabled?: boolean }>): WorkspaceRegistryV1 {
  return {
    schemaVersion: 1,
    workspaceId: 'ws1',
    files,
    settings: { paths: { bookmarksDataRoot: '.bookmarks' } },
    ui: {},
  } as any;
}

interface FakeReadersOpts {
  registry: WorkspaceRegistryV1;
  filesByPath: Map<string, BookmarksFileV2>;
  resolved?: Map<string, number>;
  hiddenFileIds?: string[];
}

function makeReaders(o: FakeReadersOpts) {
  return {
    readRegistry: async () => o.registry,
    readFileV2: async (paths: any) =>
      o.filesByPath.get(paths.data) ?? ({ schemaVersion: 2, fileId: 'x', groups: [], bookmarks: [] } as any),
    pathsForDataFile: (filePath: string) =>
      ({ dir: '', data: filePath, bak: '', lock: '', pulse: '' }),
    getBookmarksDataRoot: () => '.bookmarks',
    workspaceRelativeToUri: (rel: string, wsRoot: string) =>
      rel.startsWith('file://') ? rel : `file://${wsRoot}/${rel}`,
    getResolvedLine: (uri: string, id: string) => o.resolved?.get(`${uri}::${id}`),
    isFileHidden: (fileId: string, reg: WorkspaceRegistryV1) => {
      if (o.hiddenFileIds?.includes(fileId)) return true;
      const f = reg.files.find(x => (x as any).fileId === fileId);
      return f?.enabled === false;
    },
  };
}

const CURSOR_FILE = '/ws/src/foo.ts';

const cursor = (fileFsPath: string, line: number): CursorPosition => ({ fileFsPath, line });

// ---------------------------------------------------------------------------
// mapRevealType
// ---------------------------------------------------------------------------

describe('mapRevealType', () => {
  // VS Code TextEditorRevealType: InCenter = 1, AtTop = 3 — verified
  // against node_modules/@types/vscode/index.d.ts. (InCenterIfOutsideViewport
  // is 2 — using that for "center" leaves the line uncentered when already
  // on screen, which is the wrong behavior for a jump.)
  it('maps "top" to AtTop (3)', () => {
    expect(mapRevealType('top')).toBe(3);
  });
  it('maps "center" to InCenter (1)', () => {
    expect(mapRevealType('center')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// pickJumpTarget
// ---------------------------------------------------------------------------

describe('pickJumpTarget', () => {
  it('returns null for empty list', () => {
    expect(
      pickJumpTarget([], cursor(CURSOR_FILE, 0), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      }),
    ).toBeNull();
    expect(
      pickJumpTarget([], cursor(CURSOR_FILE, 0), 'prev', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      }),
    ).toBeNull();
  });

  describe('single bookmark in cursor file', () => {
    const b1 = vb({ bookmarkId: 'b1', fileFsPath: CURSOR_FILE, line: 10 });

    it('next when cursor is before -> returns it', () => {
      const t = pickJumpTarget([b1], cursor(CURSOR_FILE, 5), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b1');
    });

    it('next when cursor is after -> wrap=true returns it', () => {
      const t = pickJumpTarget([b1], cursor(CURSOR_FILE, 50), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b1');
    });

    it('next when cursor is after -> wrap=false returns null', () => {
      const t = pickJumpTarget([b1], cursor(CURSOR_FILE, 50), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: false,
      });
      expect(t).toBeNull();
    });

    it('next when cursor is exactly on the only bookmark, wrap=true -> returns it (re-reveals same line)', () => {
      // No bookmark is strictly after the cursor, so wrap kicks in and
      // returns scope[0] — which is the same bookmark. The command surface
      // re-reveals the line (helpful when the user has scrolled away).
      const t = pickJumpTarget([b1], cursor(CURSOR_FILE, 10), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b1');
    });

    it('prev when cursor is after -> returns it', () => {
      const t = pickJumpTarget([b1], cursor(CURSOR_FILE, 50), 'prev', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b1');
    });

    it('prev when cursor is before -> wrap=false returns null', () => {
      const t = pickJumpTarget([b1], cursor(CURSOR_FILE, 5), 'prev', {
        navigateThroughAllFiles: false,
        wrapNavigation: false,
      });
      expect(t).toBeNull();
    });
  });

  describe('multiple bookmarks in same file', () => {
    const b1 = vb({ bookmarkId: 'b1', fileFsPath: CURSOR_FILE, line: 5 });
    const b2 = vb({ bookmarkId: 'b2', fileFsPath: CURSOR_FILE, line: 15 });
    const b3 = vb({ bookmarkId: 'b3', fileFsPath: CURSOR_FILE, line: 25 });

    it('next from cursor before all -> first', () => {
      const t = pickJumpTarget([b1, b2, b3], cursor(CURSOR_FILE, 0), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b1');
    });

    it('next from cursor between b2 and b3 -> b3', () => {
      const t = pickJumpTarget([b1, b2, b3], cursor(CURSOR_FILE, 20), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b3');
    });

    it('next when cursor is on b1 -> skips current, returns b2', () => {
      const t = pickJumpTarget([b1, b2, b3], cursor(CURSOR_FILE, 5), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b2');
    });

    it('prev from cursor between b2 and b3 -> b2', () => {
      const t = pickJumpTarget([b1, b2, b3], cursor(CURSOR_FILE, 20), 'prev', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b2');
    });

    it('prev when cursor is on b3 -> skips current, returns b2', () => {
      const t = pickJumpTarget([b1, b2, b3], cursor(CURSOR_FILE, 25), 'prev', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b2');
    });

    it('next from cursor after last bookmark, wrap=true -> b1', () => {
      const t = pickJumpTarget([b1, b2, b3], cursor(CURSOR_FILE, 100), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b1');
    });

    it('next from cursor after last bookmark, wrap=false -> null', () => {
      const t = pickJumpTarget([b1, b2, b3], cursor(CURSOR_FILE, 100), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: false,
      });
      expect(t).toBeNull();
    });

    it('prev from cursor before first bookmark, wrap=true -> b3 (last)', () => {
      const t = pickJumpTarget([b1, b2, b3], cursor(CURSOR_FILE, 0), 'prev', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b3');
    });

    it('prev from cursor before first bookmark, wrap=false -> null', () => {
      const t = pickJumpTarget([b1, b2, b3], cursor(CURSOR_FILE, 0), 'prev', {
        navigateThroughAllFiles: false,
        wrapNavigation: false,
      });
      expect(t).toBeNull();
    });
  });

  describe('multi-file', () => {
    const FILE_A = '/ws/src/a.ts';
    const FILE_B = '/ws/src/b.ts';
    const FILE_C = '/ws/src/c.ts';
    const a1 = vb({ bookmarkId: 'a1', fileFsPath: FILE_A, line: 10 });
    const a2 = vb({ bookmarkId: 'a2', fileFsPath: FILE_A, line: 20 });
    const b1 = vb({ bookmarkId: 'b1', fileFsPath: FILE_B, line: 5 });
    const b2 = vb({ bookmarkId: 'b2', fileFsPath: FILE_B, line: 30 });
    const c1 = vb({ bookmarkId: 'c1', fileFsPath: FILE_C, line: 7 });
    const all = [a1, a2, b1, b2, c1];

    it('cursor in middle of B between b1 and b2 -> next is b2 (regardless of navigateThroughAllFiles)', () => {
      const allFiles = pickJumpTarget(all, cursor(FILE_B, 10), 'next', {
        navigateThroughAllFiles: true,
        wrapNavigation: true,
      });
      expect(allFiles?.bookmarkId).toBe('b2');
      const sameFile = pickJumpTarget(all, cursor(FILE_B, 10), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(sameFile?.bookmarkId).toBe('b2');
    });

    it('cursor at end of file A, navigateThroughAllFiles=true -> first bookmark of next file (b1)', () => {
      const t = pickJumpTarget(all, cursor(FILE_A, 100), 'next', {
        navigateThroughAllFiles: true,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b1');
    });

    it('cursor at end of file A, navigateThroughAllFiles=false, wrap=true -> first bookmark in A (a1)', () => {
      const t = pickJumpTarget(all, cursor(FILE_A, 100), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('a1');
    });

    it('cursor at end of file A, navigateThroughAllFiles=false, wrap=false -> null', () => {
      const t = pickJumpTarget(all, cursor(FILE_A, 100), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: false,
      });
      expect(t).toBeNull();
    });

    it('cursor at end of LAST file, navigateThroughAllFiles=true, wrap=true -> first global (a1)', () => {
      const t = pickJumpTarget(all, cursor(FILE_C, 100), 'next', {
        navigateThroughAllFiles: true,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('a1');
    });

    it('cursor at end of LAST file, navigateThroughAllFiles=true, wrap=false -> null', () => {
      const t = pickJumpTarget(all, cursor(FILE_C, 100), 'next', {
        navigateThroughAllFiles: true,
        wrapNavigation: false,
      });
      expect(t).toBeNull();
    });

    it('cursor in non-bookmarked file between A and B (alphabetically), navigateThroughAllFiles=true -> first bookmark in B', () => {
      const NON_BOOKMARK_FILE = '/ws/src/aa-other.ts'; // sorts between a.ts and b.ts
      const t = pickJumpTarget(all, cursor(NON_BOOKMARK_FILE, 999), 'next', {
        navigateThroughAllFiles: true,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b1');
    });

    it('cursor in non-bookmarked file beyond all, navigateThroughAllFiles=true, wrap=true -> first global', () => {
      const NON_BOOKMARK_FILE = '/ws/src/zzzz.ts';
      const t = pickJumpTarget(all, cursor(NON_BOOKMARK_FILE, 0), 'next', {
        navigateThroughAllFiles: true,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('a1');
    });

    it('cursor in non-bookmarked file, navigateThroughAllFiles=false -> null', () => {
      const NON_BOOKMARK_FILE = '/ws/src/zzzz.ts';
      const t = pickJumpTarget(all, cursor(NON_BOOKMARK_FILE, 0), 'next', {
        navigateThroughAllFiles: false,
        wrapNavigation: true,
      });
      expect(t).toBeNull();
    });

    it('prev mirror: cursor at start of FIRST bookmark file, navigateThroughAllFiles=true, wrap=true -> last globally (c1)', () => {
      const t = pickJumpTarget(all, cursor(FILE_A, 0), 'prev', {
        navigateThroughAllFiles: true,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('c1');
    });

    it('prev mirror: cursor at start of file A, navigateThroughAllFiles=true, wrap=false -> null', () => {
      const t = pickJumpTarget(all, cursor(FILE_A, 0), 'prev', {
        navigateThroughAllFiles: true,
        wrapNavigation: false,
      });
      expect(t).toBeNull();
    });

    it('prev: cursor in middle of B, navigateThroughAllFiles=true -> b1 (same file before cursor)', () => {
      const t = pickJumpTarget(all, cursor(FILE_B, 10), 'prev', {
        navigateThroughAllFiles: true,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('b1');
    });

    it('prev: cursor before all in file B, navigateThroughAllFiles=true -> a2 (last bookmark of previous file)', () => {
      const t = pickJumpTarget(all, cursor(FILE_B, 0), 'prev', {
        navigateThroughAllFiles: true,
        wrapNavigation: true,
      });
      expect(t?.bookmarkId).toBe('a2');
    });
  });
});

// ---------------------------------------------------------------------------
// collectVisibleBookmarks
// ---------------------------------------------------------------------------

describe('collectVisibleBookmarks', () => {
  const folders = [{ uri: { fsPath: '/ws' } }];
  const baseUI: UIStateForJump = { hidden: [], focus: null, filterEnabled: false };
  const noOpUIState = (): UIStateForJump => baseUI;

  it('returns [] when no files registered', async () => {
    const reg = makeRegistry([]);
    const r = makeReaders({ registry: reg, filesByPath: new Map() });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: noOpUIState,
    });
    expect(result).toEqual([]);
  });

  it('returns [] when files have no bookmarks', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      ['.bookmarks/shared/a.json', makeFile([])],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: noOpUIState,
    });
    expect(result).toEqual([]);
  });

  it('one file two bookmarks -> sorted by line', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({ id: 'b1', uri: 'src/foo.ts', anchor: { kind: 'point', line: 20 } }),
          bookmark({ id: 'b2', uri: 'src/foo.ts', anchor: { kind: 'point', line: 5 } }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: noOpUIState,
    });
    expect(result.map(b => b.bookmarkId)).toEqual(['b2', 'b1']);
    expect(result[0].line).toBe(5);
    expect(result[1].line).toBe(20);
  });

  it('two files -> sorted by (fileFsPath localeCompare, then line)', async () => {
    const reg = makeRegistry([
      { fileId: 'F1', path: '.bookmarks/shared/a.json' },
      { fileId: 'F2', path: '.bookmarks/shared/b.json' },
    ]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([bookmark({ id: 'b-zlast', uri: 'src/z.ts', anchor: { kind: 'point', line: 1 } })]),
      ],
      [
        '.bookmarks/shared/b.json',
        makeFile([
          bookmark({ id: 'b-afirst', uri: 'src/a.ts', anchor: { kind: 'point', line: 50 } }),
          bookmark({ id: 'b-asecond', uri: 'src/a.ts', anchor: { kind: 'point', line: 10 } }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: noOpUIState,
    });
    // src/a.ts (line 10), src/a.ts (line 50), src/z.ts (line 1)
    expect(result.map(b => b.bookmarkId)).toEqual(['b-asecond', 'b-afirst', 'b-zlast']);
  });

  it('skips files with enabled=false', async () => {
    const reg = makeRegistry([
      { fileId: 'F1', path: '.bookmarks/shared/a.json', enabled: true },
      { fileId: 'F2', path: '.bookmarks/shared/b.json', enabled: false },
    ]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([bookmark({ id: 'b1', uri: 'src/foo.ts' })]),
      ],
      [
        '.bookmarks/shared/b.json',
        makeFile([bookmark({ id: 'b2', uri: 'src/bar.ts' })]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: noOpUIState,
    });
    expect(result.map(b => b.bookmarkId)).toEqual(['b1']);
  });

  it('skips files in UIState.hiddenFiles', async () => {
    const reg = makeRegistry([
      { fileId: 'F1', path: '.bookmarks/shared/a.json' },
      { fileId: 'F2', path: '.bookmarks/shared/b.json' },
    ]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([bookmark({ id: 'b1', uri: 'src/foo.ts' })]),
      ],
      [
        '.bookmarks/shared/b.json',
        makeFile([bookmark({ id: 'b2', uri: 'src/bar.ts' })]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath, hiddenFileIds: ['F2'] });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: noOpUIState,
    });
    expect(result.map(b => b.bookmarkId)).toEqual(['b1']);
  });

  it('filterEnabled=false -> group/search filters NOT applied (returns everything visible)', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({ id: 'b1', groupId: 'gA', uri: 'src/foo.ts' }),
          bookmark({ id: 'b2', groupId: 'gB', uri: 'src/foo.ts', anchor: { kind: 'point', line: 10 } }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      // group gB hidden, but filterEnabled=false should ignore it
      getUIState: () => ({ hidden: ['gB'], focus: 'gA', filterEnabled: false }),
    });
    expect(result.map(b => b.bookmarkId).sort()).toEqual(['b1', 'b2']);
  });

  it('filterEnabled=true + group hidden -> excludes that group', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({ id: 'b1', groupId: 'gA', uri: 'src/foo.ts' }),
          bookmark({ id: 'b2', groupId: 'gB', uri: 'src/foo.ts', anchor: { kind: 'point', line: 10 } }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({ hidden: ['gB'], focus: null, filterEnabled: true }),
    });
    expect(result.map(b => b.bookmarkId)).toEqual(['b1']);
  });

  it('filterEnabled=true + focus -> only focused group', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({ id: 'b1', groupId: 'gA', uri: 'src/foo.ts' }),
          bookmark({ id: 'b2', groupId: 'gB', uri: 'src/foo.ts', anchor: { kind: 'point', line: 10 } }),
          bookmark({ id: 'b3', groupId: 'gC', uri: 'src/foo.ts', anchor: { kind: 'point', line: 15 } }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({ hidden: [], focus: 'gB', filterEnabled: true }),
    });
    expect(result.map(b => b.bookmarkId)).toEqual(['b2']);
  });

  it('filterEnabled=true + focus also in hidden -> focus wins (matches treeProvider)', async () => {
    // Focus wins over hidden: when a focus is set, only the focused group is
    // visible and the hidden list is ignored for that group. So jump includes
    // bookmarks in the focused group even when it also appears in `hidden`.
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({ id: 'b1', groupId: 'gA', uri: 'src/foo.ts' }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({ hidden: ['gA'], focus: 'gA', filterEnabled: true }),
    });
    expect(result.map(b => b.bookmarkId)).toEqual(['b1']);
  });

  it('filterEnabled=true + focus set inside a UIState.hiddenFiles file -> focus wins (file included)', async () => {
    // Bullseye on a group inside a UI-hidden file: focus is the trump card
    // and the focused group's bookmarks become navigable, mirroring the
    // group-level precedence from SML-1380 at the file boundary.
    const reg = makeRegistry([
      { fileId: 'F1', path: '.bookmarks/shared/a.json' },
      { fileId: 'F2', path: '.bookmarks/shared/b.json' },
    ]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([bookmark({ id: 'a1', groupId: 'gA', uri: 'src/foo.ts' })]),
      ],
      [
        '.bookmarks/shared/b.json',
        makeFile([
          bookmark({ id: 'b1', groupId: 'gB', uri: 'src/bar.ts' }),
          bookmark({ id: 'b2', groupId: 'gC', uri: 'src/bar.ts', anchor: { kind: 'point', line: 10 } }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath, hiddenFileIds: ['F2'] });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({ hidden: [], focus: 'gB', filterEnabled: true, hiddenFiles: ['F2'] }),
    });
    // F2 is UI-hidden, but gB (inside F2) is focused. The group-level focus
    // filter narrows to gB only; a1 (gA in F1) is excluded by focus.
    expect(result.map(b => b.bookmarkId)).toEqual(['b1']);
  });

  it('filterEnabled=true + focus set inside a registry-disabled file -> file still skipped', async () => {
    // Registry-disable always wins, even over focus. Out of scope for
    // bullseye-trumps-hide semantics (see SML-1381's "enabled is out of scope").
    const reg = makeRegistry([
      { fileId: 'F1', path: '.bookmarks/shared/a.json' },
      { fileId: 'F2', path: '.bookmarks/shared/b.json', enabled: false },
    ]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([bookmark({ id: 'a1', groupId: 'gA', uri: 'src/foo.ts' })]),
      ],
      [
        '.bookmarks/shared/b.json',
        makeFile([bookmark({ id: 'b1', groupId: 'gB', uri: 'src/bar.ts' })]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({ hidden: [], focus: 'gB', filterEnabled: true }),
    });
    // gB is focused, but F2 is disabled — no bookmarks. a1 in F1 is excluded by focus.
    expect(result.map(b => b.bookmarkId)).toEqual([]);
  });

  it('filterEnabled=false + UIState.hiddenFiles set + focus set -> file still skipped (no bypass when filterEnabled=false)', async () => {
    // When filterEnabled is false, group-level focus/hidden don't apply, so
    // the file-level UI-hide doesn't get the focus bypass either.
    const reg = makeRegistry([
      { fileId: 'F1', path: '.bookmarks/shared/a.json' },
      { fileId: 'F2', path: '.bookmarks/shared/b.json' },
    ]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([bookmark({ id: 'a1', groupId: 'gA', uri: 'src/foo.ts' })]),
      ],
      [
        '.bookmarks/shared/b.json',
        makeFile([bookmark({ id: 'b1', groupId: 'gB', uri: 'src/bar.ts' })]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath, hiddenFileIds: ['F2'] });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({ hidden: [], focus: 'gB', filterEnabled: false, hiddenFiles: ['F2'] }),
    });
    expect(result.map(b => b.bookmarkId)).toEqual(['a1']);
  });

  it('filterEnabled=true + AND search "foo" -> only label/note/lineCache contain foo', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({ id: 'b1', uri: 'src/foo.ts', label: 'this has foo word' }),
          bookmark({ id: 'b2', uri: 'src/foo.ts', label: 'unrelated', anchor: { kind: 'point', line: 10 } }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({
        hidden: [],
        focus: null,
        filterEnabled: true,
        searches: [{ id: 's1', text: 'foo', regex: false, op: 'AND' }],
      }),
    });
    expect(result.map(b => b.bookmarkId)).toEqual(['b1']);
  });

  it('filterEnabled=true + two AND searches -> must match both', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({ id: 'b1', uri: 'src/foo.ts', label: 'foo and bar', note: 'baz' }),
          bookmark({ id: 'b2', uri: 'src/foo.ts', label: 'foo only', anchor: { kind: 'point', line: 10 } }),
          bookmark({ id: 'b3', uri: 'src/foo.ts', label: 'bar only', anchor: { kind: 'point', line: 15 } }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({
        hidden: [],
        focus: null,
        filterEnabled: true,
        searches: [
          { id: 's1', text: 'foo', regex: false, op: 'AND' },
          { id: 's2', text: 'bar', regex: false, op: 'AND' },
        ],
      }),
    });
    expect(result.map(b => b.bookmarkId)).toEqual(['b1']);
  });

  it('filterEnabled=true + one OR search -> must match it', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({ id: 'b1', uri: 'src/foo.ts', label: 'foo' }),
          bookmark({ id: 'b2', uri: 'src/foo.ts', label: 'unrelated', anchor: { kind: 'point', line: 10 } }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({
        hidden: [],
        focus: null,
        filterEnabled: true,
        searches: [{ id: 's1', text: 'foo', regex: false, op: 'OR' }],
      }),
    });
    expect(result.map(b => b.bookmarkId)).toEqual(['b1']);
  });

  it('filterEnabled=true + AND + OR mix -> ANDs all match AND >=1 OR matches', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          // matches AND "foo" + matches OR "x" via label
          bookmark({ id: 'b1', uri: 'src/foo.ts', label: 'foo x' }),
          // matches AND "foo" but no OR
          bookmark({ id: 'b2', uri: 'src/foo.ts', label: 'foo only', anchor: { kind: 'point', line: 10 } }),
          // missing AND "foo"
          bookmark({ id: 'b3', uri: 'src/foo.ts', label: 'x only', anchor: { kind: 'point', line: 15 } }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({
        hidden: [],
        focus: null,
        filterEnabled: true,
        searches: [
          { id: 's1', text: 'foo', regex: false, op: 'AND' },
          { id: 's2', text: 'x', regex: false, op: 'OR' },
        ],
      }),
    });
    expect(result.map(b => b.bookmarkId)).toEqual(['b1']);
  });

  it('filterEnabled=true + regex search -> applied to label/note/lineCache', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({ id: 'b1', uri: 'src/foo.ts', label: 'TODO: fix' }),
          bookmark({ id: 'b2', uri: 'src/foo.ts', label: 'no match', anchor: { kind: 'point', line: 10 } }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({
        hidden: [],
        focus: null,
        filterEnabled: true,
        searches: [{ id: 's1', text: '^TODO', regex: true, op: 'AND' }],
      }),
    });
    expect(result.map(b => b.bookmarkId)).toEqual(['b1']);
  });

  it('filterEnabled=true + invalid regex search -> swallows the error and excludes the bookmark', async () => {
    // The regex `[invalid` is malformed; the helper must catch the
    // `new RegExp` throw and treat it as a non-match (rather than crashing).
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([bookmark({ id: 'b1', uri: 'src/foo.ts', label: 'anything' })]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({
        hidden: [],
        focus: null,
        filterEnabled: true,
        searches: [{ id: 's1', text: '[invalid', regex: true, op: 'AND' }],
      }),
    });
    expect(result).toEqual([]);
  });

  it('smart anchor with getResolvedLine returning value -> uses resolved line', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({
            id: 'b1',
            uri: 'src/foo.ts',
            anchor: {
              kind: 'smart',
              lineCache: '',
              contextBefore: [],
              contextAfter: [],
              lastUpdatedLine: 100,
              nonce: 0,
            },
          }),
        ]),
      ],
    ]);
    const r = makeReaders({
      registry: reg,
      filesByPath,
      resolved: new Map([['file:///ws/src/foo.ts::b1', 42]]),
    });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: noOpUIState,
    });
    expect(result[0].line).toBe(42);
  });

  it('smart anchor with getResolvedLine returning undefined -> falls back to lastUpdatedLine', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({
            id: 'b1',
            uri: 'src/foo.ts',
            anchor: {
              kind: 'smart',
              lineCache: '',
              contextBefore: [],
              contextAfter: [],
              lastUpdatedLine: 100,
              nonce: 0,
            },
          }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: noOpUIState,
    });
    expect(result[0].line).toBe(100);
  });

  it('tag anchor uses same fallback rule (resolved if present, else lastUpdatedLine)', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({
            id: 'b1',
            uri: 'src/foo.ts',
            anchor: { kind: 'tag', tagId: 'X', lastUpdatedLine: 7, nonce: 0 },
          }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const noResolved = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: noOpUIState,
    });
    expect(noResolved[0].line).toBe(7);

    const r2 = makeReaders({
      registry: reg,
      filesByPath,
      resolved: new Map([['file:///ws/src/foo.ts::b1', 99]]),
    });
    const withResolved = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r2,
      getUIState: noOpUIState,
    });
    expect(withResolved[0].line).toBe(99);
  });

  it('range anchor -> uses start.line', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({
            id: 'b1',
            uri: 'src/foo.ts',
            anchor: { kind: 'range', start: { line: 12 }, end: { line: 20 } },
          }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: noOpUIState,
    });
    expect(result[0].line).toBe(12);
  });

  it('absolute file:// uri -> normalized to fsPath', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({ id: 'b1', uri: 'file:///abs/path/foo.ts' }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: noOpUIState,
    });
    expect(result[0].fileFsPath).toBe('/abs/path/foo.ts');
    expect(result[0].fileAbsoluteUri).toBe('file:///abs/path/foo.ts');
  });

  it('workspace-relative uri -> joined with wsRoot', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({ id: 'b1', uri: 'src/foo.ts' }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: noOpUIState,
    });
    expect(result[0].fileFsPath).toBe('/ws/src/foo.ts');
    expect(result[0].fileAbsoluteUri).toBe('file:///ws/src/foo.ts');
  });

  it('uri with #fragment -> fragment stripped before normalization', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({ id: 'b1', uri: 'src/foo.ts#someFragment' }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const result = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: noOpUIState,
    });
    expect(result[0].fileFsPath).toBe('/ws/src/foo.ts');
  });
});

// ---------------------------------------------------------------------------
// AC integration tests: collect + pick together
// ---------------------------------------------------------------------------

describe('collect + pick integration', () => {
  const folders = [{ uri: { fsPath: '/ws' } }];

  it('AC2: hidden group is not visited by jumpNext', async () => {
    const reg = makeRegistry([{ fileId: 'F1', path: '.bookmarks/shared/a.json' }]);
    const filesByPath = new Map<string, BookmarksFileV2>([
      [
        '.bookmarks/shared/a.json',
        makeFile([
          bookmark({ id: 'b1', groupId: 'gA', uri: 'src/foo.ts', anchor: { kind: 'point', line: 5 } }),
          bookmark({ id: 'bHIDDEN', groupId: 'gB', uri: 'src/foo.ts', anchor: { kind: 'point', line: 10 } }),
          bookmark({ id: 'b3', groupId: 'gA', uri: 'src/foo.ts', anchor: { kind: 'point', line: 20 } }),
        ]),
      ],
    ]);
    const r = makeReaders({ registry: reg, filesByPath });
    const visible = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({ hidden: ['gB'], focus: null, filterEnabled: true }),
    });
    // Cursor at line 7 (between b1 and bHIDDEN). Next must skip bHIDDEN -> b3.
    const target = pickJumpTarget(visible, cursor('/ws/src/foo.ts', 7), 'next', {
      navigateThroughAllFiles: false,
      wrapNavigation: true,
    });
    expect(target?.bookmarkId).toBe('b3');
  });

  it('AC7: empty visible list -> pickJumpTarget returns null (caller would no-op)', async () => {
    const reg = makeRegistry([]);
    const r = makeReaders({ registry: reg, filesByPath: new Map() });
    const visible = await collectVisibleBookmarks({
      workspaceFolders: folders,
      ...r,
      getUIState: () => ({ hidden: [], focus: null, filterEnabled: false }),
    });
    expect(visible).toEqual([]);
    const target = pickJumpTarget(visible, cursor('/ws/src/foo.ts', 0), 'next', {
      navigateThroughAllFiles: true,
      wrapNavigation: true,
    });
    expect(target).toBeNull();
  });
});
