// ABOUTME: Multi-root tests for removeAtLine / clearFile / clearAll — they must resolve the
// ABOUTME: active file's OWNING workspace folder (per-file) and clearAll must span every folder (SML-1519).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable mock state, hoisted so the vi.mock factories below can read it safely.
const mockState = vi.hoisted(() => ({
  workspaceFolders: [] as Array<{ uri: { fsPath: string; toString(): string } }>,
  activeEditor: null as any,
  resolvedLine: 0,
  // Per-root registry fixtures: root -> { files: [{ path, enabled }] }
  registries: {} as Record<string, any>,
  // Keyed by `${root}::${rfPath}` -> BookmarksFileV2
  fileData: {} as Record<string, any>,
  // Recording arrays.
  readRegistryCalls: [] as string[],
  pathsForDataFileCalls: [] as Array<{ rfPath: string; root: string; dataRoot: string }>,
  workspaceRelativeToUriCalls: [] as Array<{ rel: string; root: string }>,
  editFileV2Calls: [] as Array<{ dataPath: string }>,
}));

function folder(fsPath: string) {
  return { uri: { fsPath, toString: () => `file://${fsPath}` } };
}

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
      openTextDocument: vi.fn(async (uri: any) => ({
        uri,
        save: vi.fn(async () => {}),
      })),
      getConfiguration: () => ({
        get: (k: string, d: any) =>
          k === 'confirmClear' ? false : k === 'dataRoot' ? '.bookmarks' : d,
      }),
    },
    Uri,
  };
});

// Shared handle for registered command handlers (assigned inside the vscode factory).
const registeredCommands = new Map<string, any>();

vi.mock('@agentic-bookmarks/core', () => ({
  readRegistry: vi.fn(async (root: string) => {
    mockState.readRegistryCalls.push(root);
    return mockState.registries[root] ?? { files: [] };
  }),
  readFileV2: vi.fn(async (paths: any) => {
    const found = Object.entries(mockState.fileData).find(
      ([, v]) => (v as any).__dataPath === paths.data
    );
    if (!found) return { schemaVersion: 2, fileId: 'f', groups: [], bookmarks: [] };
    return found[1];
  }),
  editFileV2: vi.fn(async (paths: any, mutate: any) => {
    mockState.editFileV2Calls.push({ dataPath: paths.data });
    const found = Object.entries(mockState.fileData).find(
      ([, v]) => (v as any).__dataPath === paths.data
    );
    if (found) mutate(found[1]);
  }),
  pathsForDataFile: (rfPath: string, root: string, dataRoot: string) => {
    mockState.pathsForDataFileCalls.push({ rfPath, root, dataRoot });
    return { data: `${root}/${dataRoot}/${rfPath}.json`, dir: '', bak: '', lock: '', pulse: '' };
  },
  workspaceRelativeToUri: (rel: string, root: string) => {
    mockState.workspaceRelativeToUriCalls.push({ rel, root });
    return `file://${root}/${rel}`;
  },
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
  resolveLineFromArg: () => mockState.resolvedLine,
  removeTagComment: vi.fn(async () => true),
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

function pointBookmark(id: string, uri: string, line: number): any {
  return {
    id,
    fileId: 'f1',
    groupId: 'gA',
    target: { uri },
    anchor: { kind: 'point', line },
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
  const log = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    trace() {},
  } as any;
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
  mockState.workspaceFolders = [];
  mockState.activeEditor = null;
  mockState.resolvedLine = 0;
  mockState.registries = {};
  mockState.fileData = {};
  mockState.readRegistryCalls = [];
  mockState.pathsForDataFileCalls = [];
  mockState.workspaceRelativeToUriCalls = [];
  mockState.editFileV2Calls = [];
  vi.clearAllMocks();
});

function activeEditorFor(fsPath: string) {
  return {
    document: {
      uri: {
        fsPath,
        toString: () => `file://${fsPath}`,
        with: () => ({ toString: () => `file://${fsPath}`, fsPath }),
      },
      languageId: 'typescript',
      getText: () => 'a\nb\nc\nd\ne\nf\ng\nh',
    },
    selection: { active: { line: 0 }, isEmpty: true },
  };
}

describe('removeAtLine — multi-root owning-folder resolution (SML-1519)', () => {
  it('uses the active file\'s secondary-folder registry, not folder[0]', async () => {
    mockState.workspaceFolders = [folder('/wsA'), folder('/wsB')];
    mockState.activeEditor = activeEditorFor('/wsB/src/foo.ts');
    mockState.resolvedLine = 3;
    mockState.registries['/wsB'] = { files: [{ path: 'src/foo.ts', enabled: true }] };
    const dataPath = '/wsB/.bookmarks/src/foo.ts.json';
    mockState.fileData[`B`] = makeFile(dataPath, [
      pointBookmark('b1', 'src/foo.ts', 3),
    ]);

    const handlers = getHandlers();
    await handlers.get('agenticBookmarks.removeAtLine')(undefined);

    expect(mockState.readRegistryCalls).toContain('/wsB');
    expect(mockState.readRegistryCalls).not.toContain('/wsA');
    expect(mockState.editFileV2Calls.map(c => c.dataPath)).toContain(dataPath);
    expect(mockState.fileData['B'].bookmarks).toHaveLength(0);
  });

  it('no-ops safely (error shown, no edits) when the file has no owning folder', async () => {
    const vscode = await import('vscode');
    mockState.workspaceFolders = [folder('/wsA')];
    mockState.activeEditor = activeEditorFor('/outside/foo.ts');
    mockState.resolvedLine = 1;

    const handlers = getHandlers();
    await expect(
      handlers.get('agenticBookmarks.removeAtLine')(undefined)
    ).resolves.toBeUndefined();

    expect(mockState.editFileV2Calls).toHaveLength(0);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});

describe('clearFile — multi-root owning-folder resolution (SML-1519)', () => {
  it('clears a bookmark in a secondary folder', async () => {
    mockState.workspaceFolders = [folder('/wsA'), folder('/wsB')];
    mockState.activeEditor = activeEditorFor('/wsB/src/foo.ts');
    mockState.registries['/wsB'] = { files: [{ path: 'src/foo.ts', enabled: true }] };
    const dataPath = '/wsB/.bookmarks/src/foo.ts.json';
    mockState.fileData['B'] = makeFile(dataPath, [pointBookmark('b1', 'src/foo.ts', 5)]);

    const handlers = getHandlers();
    await handlers.get('agenticBookmarks.clearFile')();

    expect(mockState.readRegistryCalls).toContain('/wsB');
    expect(mockState.readRegistryCalls).not.toContain('/wsA');
    expect(mockState.editFileV2Calls.map(c => c.dataPath)).toContain(dataPath);
    expect(mockState.fileData['B'].bookmarks).toHaveLength(0);
  });

  it('no-ops safely (error shown, no edits) when the file has no owning folder', async () => {
    const vscode = await import('vscode');
    mockState.workspaceFolders = [folder('/wsA')];
    mockState.activeEditor = activeEditorFor('/outside/foo.ts');

    const handlers = getHandlers();
    await expect(handlers.get('agenticBookmarks.clearFile')()).resolves.toBeUndefined();

    expect(mockState.editFileV2Calls).toHaveLength(0);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});

describe('clearAll — iterates every workspace folder (SML-1519)', () => {
  it('reads each folder\'s registry and clears bookmarks in both folders', async () => {
    mockState.workspaceFolders = [folder('/wsA'), folder('/wsB')];
    mockState.activeEditor = null;
    mockState.registries['/wsA'] = { files: [{ path: 'a.ts', enabled: true }] };
    mockState.registries['/wsB'] = { files: [{ path: 'b.ts', enabled: true }] };
    const dataA = '/wsA/.bookmarks/a.ts.json';
    const dataB = '/wsB/.bookmarks/b.ts.json';
    mockState.fileData['A'] = makeFile(dataA, [pointBookmark('a1', 'a.ts', 1)]);
    mockState.fileData['B'] = makeFile(dataB, [pointBookmark('b1', 'b.ts', 2)]);

    const handlers = getHandlers();
    await handlers.get('agenticBookmarks.clearAll')();

    expect(mockState.readRegistryCalls).toContain('/wsA');
    expect(mockState.readRegistryCalls).toContain('/wsB');
    const edited = mockState.editFileV2Calls.map(c => c.dataPath);
    expect(edited).toContain(dataA);
    expect(edited).toContain(dataB);
    expect(mockState.fileData['A'].bookmarks).toHaveLength(0);
    expect(mockState.fileData['B'].bookmarks).toHaveLength(0);
  });
});
