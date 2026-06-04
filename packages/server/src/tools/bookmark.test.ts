// ABOUTME: Tests for handleBookmarkAdd's destination routing — the filePath/fileId
// ABOUTME: hint that directs an auto-created group into a registered shared file (SML-1392).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { handleBookmarkAdd } from './bookmark';
import {
  createWorkspaceInfo,
  emptyFileV2,
  addFileToRegistry,
  readFileAt,
  readRegistry,
} from '@agentic-bookmarks/core';

describe('handleBookmarkAdd — nested multi-root workspace routing (SML-1575)', () => {
  let outerRoot: string;
  let innerRoot: string;
  let ctx: any;
  let srcUri: string;

  beforeEach(async () => {
    // Outer workspace with an inner workspace nested beneath it.
    outerRoot = path.join(tmpdir(), `bm-nested-outer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    innerRoot = path.join(outerRoot, 'inner');
    await fs.mkdir(innerRoot, { recursive: true });

    // Initialize registries on disk.
    await readRegistry(outerRoot);
    await readRegistry(innerRoot);

    // A real source file inside the INNER workspace.
    const srcAbs = path.join(innerRoot, 'src', 'bar.ts');
    await fs.mkdir(path.dirname(srcAbs), { recursive: true });
    await fs.writeFile(srcAbs, ['export function bar() {', '  return 2;', '}', ''].join('\n'), 'utf8');
    srcUri = pathToFileURL(srcAbs).href;

    // Outer listed FIRST — this is the ordering that triggers the first-match bug.
    ctx = {
      workspaceRoot: outerRoot,
      workspaces: [createWorkspaceInfo(outerRoot), createWorkspaceInfo(innerRoot)],
    };
  });

  afterEach(async () => {
    try { await fs.rm(outerRoot, { recursive: true, force: true }); } catch {}
  });

  it('routes bookmark_add to the deepest (nested) workspace when outer is listed first', async () => {
    const res = await handleBookmarkAdd(ctx, {
      uri: srcUri,
      groupName: 'InnerGroup',
      anchor: { kind: 'point', line: 1 },
      label: 'bar decl',
      anchorType: 'point',
    });
    const parsed = JSON.parse(res.content[0].text);

    expect(parsed.success).toBe(true);

    // The group + bookmark must land in the INNER workspace's local file, not the outer's.
    const innerReg = await readRegistry(innerRoot);
    expect(innerReg.nameIndex['InnerGroup']).toBeTruthy();

    // The outer workspace registry must NOT have been mutated.
    const outerReg = await readRegistry(outerRoot);
    expect(outerReg.nameIndex['InnerGroup']).toBeUndefined();
  });
});

describe('handleBookmarkAdd — registered-file destination hint (SML-1392)', () => {
  let root: string;
  let ctx: any;
  let srcUri: string;
  let sharedFile: string;
  let sharedFileId: string;
  const sharedRel = path.join('.bookmarks', 'shared', 'tagged-bookmarks.json');
  const localRel = path.join('.bookmarks', 'local', 'bookmarks.json');

  const localDefault = () => path.join(root, localRel);

  beforeEach(async () => {
    root = path.join(tmpdir(), `bm-add-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(root, { recursive: true });
    // Initialize the workspace registry on disk.
    await readRegistry(root);

    // A real source file to bookmark.
    const srcAbs = path.join(root, 'src', 'foo.ts');
    await fs.mkdir(path.dirname(srcAbs), { recursive: true });
    await fs.writeFile(srcAbs, ['export function foo() {', '  return 1;', '}', ''].join('\n'), 'utf8');
    srcUri = pathToFileURL(srcAbs).href;

    // A registered, empty SHARED bookmarks file.
    sharedFile = path.join(root, sharedRel);
    await fs.mkdir(path.dirname(sharedFile), { recursive: true });
    await fs.writeFile(sharedFile, JSON.stringify(emptyFileV2(), null, 2), 'utf8');
    await addFileToRegistry(root, sharedFile);
    sharedFileId = (await readFileAt(sharedFile)).fileId as string;

    ctx = { workspaceRoot: root, workspaces: [createWorkspaceInfo(root)] };
  });

  afterEach(async () => {
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch {}
  });

  it('routes a new group into the registered shared file via filePath', async () => {
    const res = await handleBookmarkAdd(ctx, {
      uri: srcUri,
      groupName: 'TaggedSeed',
      filePath: sharedFile,
      anchor: { kind: 'point', line: 1 },
      label: 'foo decl',
      anchorType: 'point',
    });
    const parsed = JSON.parse(res.content[0].text);

    expect(parsed.success).toBe(true);
    // Response identifies the destination path (AC3), not just the fileId.
    expect(parsed.fileId).toBe(sharedFileId);
    expect(parsed.filePath).toBe(sharedRel);

    // The group + bookmark landed in the registered shared file.
    const sharedData = await readFileAt(sharedFile);
    expect(sharedData.bookmarks.length).toBe(1);
    expect(sharedData.groups.some(g => g.name === 'TaggedSeed')).toBe(true);

    // The local default file was NOT created.
    await expect(fs.stat(localDefault())).rejects.toThrow();
  });

  it('routes a new group into the registered shared file via fileId', async () => {
    const res = await handleBookmarkAdd(ctx, {
      uri: srcUri,
      groupName: 'TaggedSeedById',
      fileId: sharedFileId,
      anchor: { kind: 'point', line: 1 },
      label: 'x',
      anchorType: 'point',
    });
    const parsed = JSON.parse(res.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.fileId).toBe(sharedFileId);
    expect(parsed.filePath).toBe(sharedRel);

    const sharedData = await readFileAt(sharedFile);
    expect(sharedData.bookmarks.length).toBe(1);
    expect(sharedData.groups.some(g => g.name === 'TaggedSeedById')).toBe(true);
    await expect(fs.stat(localDefault())).rejects.toThrow();
  });

  it('errors when the hint does not match a registered file', async () => {
    const res = await handleBookmarkAdd(ctx, {
      uri: srcUri,
      groupName: 'NopeGroup',
      filePath: path.join(root, '.bookmarks', 'shared', 'not-registered.json'),
      anchor: { kind: 'point', line: 1 },
      label: 'x',
      anchorType: 'point',
    });
    const parsed = JSON.parse(res.content[0].text);

    expect(parsed.success).toBe(false);
    expect(String(parsed.error)).toMatch(/regist/i);

    // Nothing was written: shared file untouched, no local file, no group in the index.
    const sharedData = await readFileAt(sharedFile);
    expect(sharedData.bookmarks.length).toBe(0);
    await expect(fs.stat(localDefault())).rejects.toThrow();
    const reg = await readRegistry(root);
    expect(reg.nameIndex['NopeGroup']).toBeUndefined();
  });

  it('with no hint a new group still lands in the local file', async () => {
    const res = await handleBookmarkAdd(ctx, {
      uri: srcUri,
      groupName: 'LocalSeed',
      anchor: { kind: 'point', line: 1 },
      label: 'x',
      anchorType: 'point',
    });
    const parsed = JSON.parse(res.content[0].text);

    expect(parsed.success).toBe(true);
    // Fallback still reports its destination path (AC3 on the fallback path).
    expect(parsed.filePath).toBe(localRel);

    // Landed in the local default file.
    const localData = await readFileAt(localDefault());
    expect(localData.bookmarks.length).toBe(1);
    expect(localData.groups.some(g => g.name === 'LocalSeed')).toBe(true);

    // The registered shared file stays empty.
    const sharedData = await readFileAt(sharedFile);
    expect(sharedData.bookmarks.length).toBe(0);
  });

  it('ignores the hint when the group already exists (routes to the existing group file)', async () => {
    // Create the group in the local file first (no hint).
    await handleBookmarkAdd(ctx, {
      uri: srcUri,
      groupName: 'Established',
      anchor: { kind: 'point', line: 1 },
      label: 'a',
      anchorType: 'point',
    });

    // Add again WITH a shared-file hint — the group already lives in local, so it stays there.
    const res = await handleBookmarkAdd(ctx, {
      uri: srcUri,
      groupName: 'Established',
      filePath: sharedFile,
      anchor: { kind: 'point', line: 2 },
      label: 'b',
      anchorType: 'point',
    });
    const parsed = JSON.parse(res.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.filePath).toBe(localRel);

    const sharedData = await readFileAt(sharedFile);
    expect(sharedData.bookmarks.length).toBe(0);
    const localData = await readFileAt(localDefault());
    expect(localData.bookmarks.length).toBe(2);
  });
});
