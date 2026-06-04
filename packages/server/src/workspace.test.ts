import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { findWorkspaceRootUpward, findGroupByName, mergeLoadedWorkspaceFolders, getOrCreateLocalFile, resolveBootstrapRoot } from './workspace';
import {
  createWorkspaceInfo,
  emptyFileV2,
  addFileToRegistry,
  createGroupInFile,
  readRegistry,
  readFileAt,
  type BookmarksFileV2,
} from '@agentic-bookmarks/core';

describe('findWorkspaceRootUpward', () => {
  let tmp: string;
  let realTmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-discovery-'));
    realTmp = await fs.realpath(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('finds the new-location registry sentinel', async () => {
    const dir = path.join(realTmp, '.bookmarks', 'local');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'bookmarks.registry.json'), '{}');
    const deep = path.join(realTmp, 'src', 'deep');
    await fs.mkdir(deep, { recursive: true });

    const found = await findWorkspaceRootUpward(deep);
    expect(found).toBe(realTmp);
  });

  it('falls back to the legacy .vscode location for unmigrated workspaces', async () => {
    const dir = path.join(realTmp, '.vscode');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'bookmarks.registry.json'), '{}');
    const sub = path.join(realTmp, 'src');
    await fs.mkdir(sub, { recursive: true });

    const found = await findWorkspaceRootUpward(sub);
    expect(found).toBe(realTmp);
  });

  it('returns null when neither sentinel exists', async () => {
    const found = await findWorkspaceRootUpward(realTmp);
    expect(found).toBeNull();
  });

  it('terminates the walk at the workspace root rather than continuing past it', async () => {
    // Both sentinels live at realTmp; starting from realTmp itself must find realTmp
    // (not climb upward and find some unrelated parent registry).
    await fs.mkdir(path.join(realTmp, '.bookmarks', 'local'), { recursive: true });
    await fs.writeFile(
      path.join(realTmp, '.bookmarks', 'local', 'bookmarks.registry.json'),
      '{}',
    );
    expect(await findWorkspaceRootUpward(realTmp)).toBe(realTmp);
  });
});

describe('findGroupByName', () => {
  let tmp: string;
  let root: string;
  let absFile: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'find-group-'));
    root = await fs.realpath(tmp);
    absFile = path.join(root, '.bookmarks', 'shared', 'shared.json');
    await fs.mkdir(path.dirname(absFile), { recursive: true });
    await fs.writeFile(absFile, JSON.stringify(emptyFileV2(), null, 2), 'utf8');
    await addFileToRegistry(root, absFile);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('returns the resolved triple for a valid index entry', async () => {
    const gId = await createGroupInFile(root, absFile, 'G');
    const ws = createWorkspaceInfo(root);

    const reg = await readRegistry(root);
    const fileEntry = reg.files.find(f => f.fileId === reg.nameIndex['G'].fileId)!;

    const result = await findGroupByName(ws, 'G');
    expect(result).toEqual({
      fileId: reg.nameIndex['G'].fileId,
      groupId: gId,
      filePath: path.join(root, fileEntry.path),
    });
  });

  it('returns null when the indexed group is absent from the file', async () => {
    await createGroupInFile(root, absFile, 'G');

    // Remove the group from the data file only, leaving the registry nameIndex
    // intact — the stale-index condition SML-1494 guards against.
    const data = await readFileAt(absFile);
    data.groups = [];
    await fs.writeFile(absFile, JSON.stringify(data, null, 2), 'utf8');

    // Pre-condition: registry nameIndex still maps 'G'.
    const reg = await readRegistry(root);
    expect(reg.nameIndex['G']).toBeTruthy();

    const ws = createWorkspaceInfo(root);
    expect(await findGroupByName(ws, 'G')).toBeNull();
  });

  it('returns null when the name is not in nameIndex', async () => {
    const ws = createWorkspaceInfo(root);
    expect(await findGroupByName(ws, 'Nonexistent')).toBeNull();
  });

  it('returns the entry when the target file is unreadable (cannot verify)', async () => {
    const gId = await createGroupInFile(root, absFile, 'G');

    const reg = await readRegistry(root);
    const fileEntry = reg.files.find(f => f.fileId === reg.nameIndex['G'].fileId)!;

    // Delete the data file so it cannot be read/verified.
    await fs.rm(absFile, { force: true });

    const ws = createWorkspaceInfo(root);
    const result = await findGroupByName(ws, 'G');
    expect(result).toEqual({
      fileId: reg.nameIndex['G'].fileId,
      groupId: gId,
      filePath: path.join(root, fileEntry.path),
    });
  });
});

describe('mergeLoadedWorkspaceFolders', () => {
  // SML-1547: merging registry loadedWorkspaceFolders must NOT discard the custom
  // registryPath/bookmarksDataRoot that init meta parsed for roots already present.
  it('preserves custom bookmarksDataRoot for a root already present', () => {
    const existing = [
      createWorkspaceInfo('/ws/a', {
        bookmarksDataRoot: '.bookmarks-custom',
        registryPath: 'custom/reg.json',
      }),
    ];

    const result = mergeLoadedWorkspaceFolders(existing, ['/ws/a']);

    expect(result).toHaveLength(1);
    expect(result[0].bookmarksDataRoot).toBe('.bookmarks-custom');
    expect(result[0].registryPath).toBe('custom/reg.json');
  });

  it('adds a new loaded folder with createWorkspaceInfo defaults', () => {
    const existing = [createWorkspaceInfo('/ws/a', { bookmarksDataRoot: '.bookmarks-custom' })];

    const result = mergeLoadedWorkspaceFolders(existing, ['/ws/a', '/ws/b']);

    expect(result).toHaveLength(2);
    const a = result.find(w => w.workspaceRoot === '/ws/a')!;
    const b = result.find(w => w.workspaceRoot === '/ws/b')!;
    expect(a.bookmarksDataRoot).toBe('.bookmarks-custom');
    // The genuinely-new root gets standard defaults.
    expect(b).toEqual(createWorkspaceInfo('/ws/b'));
  });

  it('preserves existing order; result[0] is the original primary', () => {
    const existing = [
      createWorkspaceInfo('/ws/a', { bookmarksDataRoot: '.bm-a' }),
      createWorkspaceInfo('/ws/b', { bookmarksDataRoot: '.bm-b' }),
    ];

    const result = mergeLoadedWorkspaceFolders(existing, ['/ws/c']);

    expect(result).toHaveLength(3);
    // Existing entries kept first, by identity, so the primary is unchanged.
    expect(result[0]).toBe(existing[0]);
    expect(result[1]).toBe(existing[1]);
    expect(result[2].workspaceRoot).toBe('/ws/c');
  });

  it('deduplicates a path-equivalent loaded folder to the existing entry', () => {
    const existing = [createWorkspaceInfo('/ws/a', { bookmarksDataRoot: '.bookmarks-custom' })];

    // Trailing slash resolves to the same root — must dedup to the existing entry.
    const result = mergeLoadedWorkspaceFolders(existing, ['/ws/a/']);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(existing[0]);
    expect(result[0].bookmarksDataRoot).toBe('.bookmarks-custom');
  });

  it('returns existing unchanged when there are no loaded folders', () => {
    const existing = [createWorkspaceInfo('/ws/a', { bookmarksDataRoot: '.bookmarks-custom' })];

    const result = mergeLoadedWorkspaceFolders(existing, []);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(existing[0]);
  });
});

describe('getOrCreateLocalFile', () => {
  let tmp: string;
  let root: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'get-local-'));
    root = await fs.realpath(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function registerLocalFile(fileId: string): Promise<string> {
    const localDir = path.join(root, '.bookmarks', 'local');
    const localFile = path.join(localDir, 'bookmarks.json');
    await fs.mkdir(localDir, { recursive: true });
    const data: BookmarksFileV2 = { version: 2, fileId, isLocal: true, groups: [], bookmarks: [] };
    await fs.writeFile(localFile, JSON.stringify(data, null, 2));
    await addFileToRegistry(root, localFile);
    return localFile;
  }

  it('returns the existing local file when one is already registered (POSIX path)', async () => {
    const fileId = 'posix-local-id';
    const localFile = await registerLocalFile(fileId);

    const ws = createWorkspaceInfo(root);
    const result = await getOrCreateLocalFile(ws);

    expect(result.fileId).toBe(fileId);
    expect(result.filePath).toBe(localFile);
  });

  it('does not overwrite an existing local file when the registry path uses backslash separators (Windows)', async () => {
    // Simulate a Windows-style registry: f.path uses backslashes, so
    // the old f.path.includes('/local/') check returned false and the
    // create branch ran, clobbering the existing file. isLocalPath() is
    // separator-agnostic and correctly identifies the entry.
    const fileId = 'win-local-id';
    await registerLocalFile(fileId);

    // Patch the stored path to use Windows-style backslashes.
    const regPath = path.join(root, '.bookmarks', 'local', 'bookmarks.registry.json');
    const reg = JSON.parse(await fs.readFile(regPath, 'utf8'));
    const entry = reg.files.find((f: any) => f.fileId === fileId);
    entry.path = entry.path.replace(/\//g, '\\');
    await fs.writeFile(regPath, JSON.stringify(reg, null, 2));

    const ws = createWorkspaceInfo(root);
    const result = await getOrCreateLocalFile(ws);

    // Must find the existing entry, not create a new one.
    expect(result.fileId).toBe(fileId);
  });

  it('creates a new local file when none is registered', async () => {
    // Empty workspace — readRegistry returns an empty registry when no file exists,
    // so getOrCreateLocalFile proceeds to the create branch.
    const ws = createWorkspaceInfo(root);
    const result = await getOrCreateLocalFile(ws);

    expect(result.fileId).toBeTruthy();
    const stat = await fs.stat(result.filePath);
    expect(stat.isFile()).toBe(true);
  });
});

describe('resolveBootstrapRoot', () => {
  let tmp: string;
  let realTmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bootstrap-root-'));
    realTmp = await fs.realpath(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('walks up from cwd when BOOKMARKS_UPWARD_DISCOVERY is set and registry exists', async () => {
    const registryDir = path.join(realTmp, '.bookmarks', 'local');
    await fs.mkdir(registryDir, { recursive: true });
    await fs.writeFile(path.join(registryDir, 'bookmarks.registry.json'), '{}');
    const nested = path.join(realTmp, 'src', 'components');
    await fs.mkdir(nested, { recursive: true });

    const result = await resolveBootstrapRoot({ BOOKMARKS_UPWARD_DISCOVERY: 'true' }, nested);
    expect(result).toBe(realTmp);
  });

  it('falls back to cwd when BOOKMARKS_UPWARD_DISCOVERY is set but no registry found', async () => {
    const result = await resolveBootstrapRoot({ BOOKMARKS_UPWARD_DISCOVERY: 'true' }, realTmp);
    expect(result).toBe(realTmp);
  });

  it('strips .bookmarks/local suffix from BOOKMARKS_DIR to get workspace root', async () => {
    const localDir = path.join(realTmp, '.bookmarks', 'local');
    const result = await resolveBootstrapRoot({ BOOKMARKS_DIR: localDir }, realTmp);
    expect(result).toBe(realTmp);
  });

  it('uses BOOKMARKS_DIR as-is when it does not end in local', async () => {
    const wsRoot = path.join(realTmp, 'my-workspace');
    await fs.mkdir(wsRoot, { recursive: true });
    const result = await resolveBootstrapRoot({ BOOKMARKS_DIR: wsRoot }, realTmp);
    expect(result).toBe(wsRoot);
  });

  it('returns cwd when neither env var is set', async () => {
    const result = await resolveBootstrapRoot({}, realTmp);
    expect(result).toBe(realTmp);
  });
});
