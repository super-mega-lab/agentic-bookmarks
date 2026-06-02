// ABOUTME: runClear (clearFile/clearAll) tag-comment cleanup must not save a non-active
// ABOUTME: source document that was already dirty — doing so flushes unrelated unsaved edits (SML-1536).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable mock state, hoisted so the vi.mock factories below can read it safely.
const mockState = vi.hoisted(() => ({
  workspaceFolders: [] as Array<{ uri: { fsPath: string; toString(): string } }>,
  activeEditor: null as any,
  // Per-root registry fixtures: root -> { files: [{ path, enabled }] }
  registries: {} as Record<string, any>,
  // Keyed by __dataPath -> BookmarksFileV2
  fileData: {} as Record<string, any>,
  // Controls the document returned by workspace.openTextDocument.
  openedDocDirty: false,
  openedDocSave: vi.fn(async () => {}),
  removeTagComment: vi.fn(async () => true),
}));

function folder(fsPath: string) {
  return { uri: { fsPath, toString: () => `file://${fsPath}` } };
}

// Shared handle for registered command handlers (assigned inside the vscode factory).
const registeredCommands = new Map<string, any>();

vi.mock('vscode', () => {
  const Uri = {
    parse: (s: string) => ({
      toString: () => s,
      fsPath: s.startsWith('file://') ? s.slice('file://'.length) : s,
      with: () => ({ toString: () => s, fsPath: s }),
    }),
    file: (p: string) => ({
      toString: () => `file://${p}`,
      fsPath: p,
      with: () => ({ toString: () => `file://${p}`, fsPath: p }),
    }),
  };
  return {
    commands: {
      registerCommand: (id: string, fn: any) => {
        registeredCommands.set(id, fn);
        return { dispose() {} };
      },
    },
    window: {
      get activeTextEditor() {
        return mockState.activeEditor;
      },
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    },
    workspace: {
      get workspaceFolders() {
        return mockState.workspaceFolders;
      },
      getWorkspaceFolder: (uri: any) => {
        const fsPath: string = uri.fsPath;
        return mockState.workspaceFolders.find(f => fsPath.startsWith(f.uri.fsPath));
      },
      asRelativePath: (p: string) => p,
      // Returns a NEW doc each call but shares the save spy + dirty flag so tests
      // can assert whether runClear decided to persist it.
      openTextDocument: vi.fn(async (uri: any) => ({
        uri,
        isDirty: mockState.openedDocDirty,
        save: mockState.openedDocSave,
      })),
      getConfiguration: () => ({
        get: (k: string, d: any) =>
          k === 'confirmClear' ? false : k === 'dataRoot' ? '.bookmarks' : d,
      }),
    },
    Uri,
  };
});

vi.mock('@agentic-bookmarks/core', () => ({
  readRegistry: vi.fn(async (root: string) => mockState.registries[root] ?? { files: [] }),
  readFileV2: vi.fn(async (paths: any) => {
    const found = Object.entries(mockState.fileData).find(
      ([, v]) => (v as any).__dataPath === paths.data
    );
    if (!found) return { schemaVersion: 2, fileId: 'f', groups: [], bookmarks: [] };
    return found[1];
  }),
  editFileV2: vi.fn(async (paths: any, mutate: any) => {
    const found = Object.entries(mockState.fileData).find(
      ([, v]) => (v as any).__dataPath === paths.data
    );
    if (found) mutate(found[1]);
  }),
  pathsForDataFile: (rfPath: string, root: string, dataRoot: string) => ({
    data: `${root}/${dataRoot}/${rfPath}.json`,
    dir: '',
    bak: '',
    lock: '',
    pulse: '',
  }),
  workspaceRelativeToUri: (rel: string, root: string) => `file://${root}/${rel}`,
  // Symbols used only by other handlers — simple stubs.
  getOrCreateUnsortedGroup: vi.fn(() => 'unsorted'),
  getBookmarksDataRoot: vi.fn(() => '.bookmarks'),
  createAnchor: vi.fn(() => ({ kind: 'point', line: 0 })),
  resolveIsLocal: vi.fn(() => false),
  resolveTargetAnchorType: vi.fn(() => 'point'),
  resolveTagPlacement: vi.fn(() => 'above'),
  toWorkspaceRelativePath: vi.fn((fsPath: string, root: string) => fsPath.slice(root.length + 1)),
}));

vi.mock('../workspace-helpers', () => ({
  getConfiguredDataRoot: () => '.bookmarks',
  resolveLineFromArg: () => 0,
  removeTagComment: mockState.removeTagComment,
  insertTagComment: vi.fn(async () => true),
  buildAgentRepairPrompt: vi.fn(() => 'prompt'),
}));

vi.mock('../anchorState', () => ({
  getResolvedLine: vi.fn(() => undefined),
  markBookmarkBroken: vi.fn(),
}));

vi.mock('../anchor-repair-helpers', () => ({
  runFileMoveRepairForBookmark: vi.fn(async () => ({ status: 'failed' })),
}));

vi.mock('./find-bookmarks-on-line', () => ({
  findBookmarksOnLineMatching: vi.fn(() => []),
}));

vi.mock('nanoid', () => ({ nanoid: () => 'id' }));

import { registerBookmarkCrudCommands } from './bookmark-crud';

function tagBookmark(id: string, uri: string, tagId: string, line: number): any {
  return {
    id,
    fileId: 'f1',
    groupId: 'gA',
    target: { uri },
    anchor: { kind: 'tag', tagId, lastUpdatedLine: line },
    label: '',
    createdAt: 0,
    createdBy: 'test',
    source: 'test',
    tags: [],
  };
}

function makeFile(dataPath: string, bookmarks: any[]): any {
  return {
    __dataPath: dataPath,
    schemaVersion: 2,
    fileId: 'f1',
    groups: [{ id: 'gA', name: 'A' }],
    bookmarks,
  };
}

function buildDeps() {
  const log = { debug() {}, info() {}, warn() {}, error() {}, trace() {} } as any;
  return {
    workspaceRoot: '/wsA',
    log,
    provider: { refresh() {} } as any,
    filesGroups: { refresh() {} } as any,
    codeLensProvider: null,
    updateDecorations: async () => {},
    debouncedCacheSync() {},
    getLineCacheLength: () => 0,
    getLineCacheFor: () => undefined,
    getDefaultTargetForWorkspace: async () => ({
      paths: { dir: '', data: '', bak: '', lock: '', pulse: '' },
      groupId: 'gA',
    }),
    repairDeps: {} as any,
    isFileHidden: () => false,
  } as any;
}

function getHandlers() {
  registeredCommands.clear();
  registerBookmarkCrudCommands(buildDeps());
  return registeredCommands;
}

beforeEach(() => {
  mockState.workspaceFolders = [folder('/wsA')];
  mockState.activeEditor = null;
  mockState.registries = { '/wsA': { files: [{ path: 'b.ts', enabled: true }] } };
  mockState.fileData = {
    A: makeFile('/wsA/.bookmarks/b.ts.json', [tagBookmark('t1', 'b.ts', 'TAG1', 4)]),
  };
  mockState.openedDocDirty = false;
  vi.clearAllMocks();
});

describe('runClear tag-comment cleanup — non-active document save (SML-1536)', () => {
  it('does not save a non-active document that was already dirty', async () => {
    // The source file (b.ts) is open in a background tab with unsaved edits.
    mockState.openedDocDirty = true;

    const handlers = getHandlers();
    await handlers.get('agenticBookmarks.clearAll')();

    // The tag comment is still stripped from the in-memory buffer...
    expect(mockState.removeTagComment).toHaveBeenCalledWith(
      expect.anything(),
      4,
      'TAG1'
    );
    // ...but we must NOT flush the document — that would persist the user's
    // unrelated unsaved edits.
    expect(mockState.openedDocSave).not.toHaveBeenCalled();
  });

  it('saves a non-active document that was clean', async () => {
    // The source file is not open / has no pending edits — persisting our
    // tag-comment removal keeps the file in sync with the bookmark data.
    mockState.openedDocDirty = false;

    const handlers = getHandlers();
    await handlers.get('agenticBookmarks.clearAll')();

    expect(mockState.removeTagComment).toHaveBeenCalledWith(
      expect.anything(),
      4,
      'TAG1'
    );
    expect(mockState.openedDocSave).toHaveBeenCalledTimes(1);
  });
});
