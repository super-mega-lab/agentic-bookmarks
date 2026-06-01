// ABOUTME: Tests for file-group MCP handlers — covers handleFileCreate's happy
// ABOUTME: path and the collision-detection branch that prevents silent overwrite.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  handleFileCreate,
  handleGroupDelete,
  handleGroupRename,
  handleGroupMoveFile,
} from './file-group';
import {
  createWorkspaceInfo,
  emptyFileV2,
  addFileToRegistry,
  createGroupInFile,
  readRegistry,
  readFileAt,
} from '@agentic-bookmarks/core';

describe('handleFileCreate', () => {
  let testDir: string;
  let ctx: any;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `file-group-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(testDir, { recursive: true });
    ctx = { workspaceRoot: testDir };
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('creates a new v2 bookmarks file when path is free', async () => {
    const target = path.join(testDir, 'new.json');

    const result = await handleFileCreate(ctx, { path: target, title: 'Test' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(typeof parsed.fileId).toBe('string');
    expect(parsed.fileId.length).toBeGreaterThan(0);

    // File exists on disk and parses as a v2 bookmarks file
    const raw = await fs.readFile(target, 'utf8');
    const fileJson = JSON.parse(raw);
    expect(fileJson.version).toBe(2);
    expect(typeof fileJson.fileId).toBe('string');
    expect(Array.isArray(fileJson.groups)).toBe(true);
    expect(fileJson.groups.length).toBeGreaterThanOrEqual(1);
    expect(fileJson.groups[0].name).toBe('Unsorted');

    // Registry was updated with the new file
    const registryPath = path.join(testDir, '.bookmarks', 'local', 'bookmarks.registry.json');
    const registryRaw = await fs.readFile(registryPath, 'utf8');
    const registry = JSON.parse(registryRaw);
    expect(Array.isArray(registry.files)).toBe(true);
    expect(registry.files.length).toBe(1);
  });

  it('rejects with structured JSON when file already exists', async () => {
    const target = path.join(testDir, 'existing.json');
    await fs.writeFile(
      target,
      JSON.stringify({ version: 2, fileId: 'sentinel-existing', groups: [], bookmarks: [] }),
      'utf8'
    );

    const result = await handleFileCreate(ctx, { path: target });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      success: false,
      error: 'File already exists',
      path: path.resolve(target),
    });
  });

  it('does not modify the on-disk file when rejecting a collision', async () => {
    const target = path.join(testDir, 'existing.json');
    const originalContent = JSON.stringify({
      version: 2,
      fileId: 'sentinel-existing',
      groups: [
        {
          id: 'g-original',
          name: 'Original',
          icon: {},
          isUnsorted: false,
          createdAt: 1234567890,
        },
      ],
      bookmarks: [{ id: 'b1' }],
    });
    await fs.writeFile(target, originalContent, 'utf8');
    const beforeBytes = await fs.readFile(target);

    const result = await handleFileCreate(ctx, { path: target });

    // Sanity: the call rejected
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('File already exists');

    // File on disk must be byte-equal to what we wrote
    const afterBytes = await fs.readFile(target);
    expect(afterBytes.equals(beforeBytes)).toBe(true);

    // The original fileId is still present; no new fileId was written
    const afterText = afterBytes.toString('utf8');
    expect(afterText).toContain('sentinel-existing');
  });
});

describe('multi-workspace group ops', () => {
  let primaryRoot: string;
  let secondaryRoot: string;
  let ctx: any;

  function mkRoot(label: string): string {
    return path.join(
      tmpdir(),
      `file-group-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  /**
   * Write an empty v2 file at `absFile`, register it in `root`'s registry, and
   * create a group named `name` in it. Returns the created groupId. This sets up
   * the group in the SECONDARY registry's nameIndex (root === secondaryRoot).
   */
  async function setupGroupInWorkspace(
    root: string,
    absFile: string,
    name: string
  ): Promise<string> {
    await fs.mkdir(path.dirname(absFile), { recursive: true });
    await fs.writeFile(absFile, JSON.stringify(emptyFileV2(), null, 2), 'utf8');
    await addFileToRegistry(root, absFile);
    return createGroupInFile(root, absFile, name);
  }

  beforeEach(async () => {
    primaryRoot = mkRoot('primary');
    secondaryRoot = mkRoot('secondary');
    await fs.mkdir(primaryRoot, { recursive: true });
    await fs.mkdir(secondaryRoot, { recursive: true });
    // Initialize the primary registry so it exists on disk.
    await readRegistry(primaryRoot);
    ctx = {
      workspaceRoot: primaryRoot,
      workspaces: [createWorkspaceInfo(primaryRoot), createWorkspaceInfo(secondaryRoot)],
    };
  });

  afterEach(async () => {
    for (const dir of [primaryRoot, secondaryRoot]) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('handleGroupDelete on a secondary-workspace file removes the stale entry from the SECONDARY registry nameIndex', async () => {
    const absFile = path.join(secondaryRoot, '.bookmarks', 'shared', 'shared.json');
    const groupId = await setupGroupInWorkspace(secondaryRoot, absFile, 'G');

    // Pre-condition: secondary nameIndex has 'G'.
    const before = await readRegistry(secondaryRoot);
    expect(before.nameIndex['G']).toBeTruthy();
    expect(before.nameIndex['G'].groupId).toBe(groupId);

    await handleGroupDelete(ctx, { filePath: absFile, groupId });

    // The SECONDARY registry nameIndex no longer contains 'G'.
    const after = await readRegistry(secondaryRoot);
    expect(after.nameIndex['G']).toBeUndefined();

    // The PRIMARY registry was not the one mutated (it never had 'G').
    const primaryReg = await readRegistry(primaryRoot);
    expect(primaryReg.nameIndex['G']).toBeUndefined();
  });

  it('handleGroupRename on a secondary-workspace group renames in the secondary file and updates the SECONDARY nameIndex', async () => {
    const absFile = path.join(secondaryRoot, '.bookmarks', 'shared', 'shared.json');
    const groupId = await setupGroupInWorkspace(secondaryRoot, absFile, 'G');

    const result = await handleGroupRename(ctx, { groupId, newName: 'H' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);

    // Secondary data file group renamed to 'H'.
    const data = await readFileAt(absFile);
    const group = data.groups.find(g => g.id === groupId);
    expect(group?.name).toBe('H');

    // Secondary nameIndex has 'H', not 'G'.
    const after = await readRegistry(secondaryRoot);
    expect(after.nameIndex['H']).toBeTruthy();
    expect(after.nameIndex['H'].groupId).toBe(groupId);
    expect(after.nameIndex['G']).toBeUndefined();
  });

  it('handleGroupMoveFile moves a group between two files in the secondary workspace', async () => {
    const sourceFile = path.join(secondaryRoot, '.bookmarks', 'shared', 'source.json');
    const destFile = path.join(secondaryRoot, '.bookmarks', 'shared', 'dest.json');
    const groupId = await setupGroupInWorkspace(secondaryRoot, sourceFile, 'G');

    // Register an empty destination file in the secondary workspace.
    await fs.writeFile(destFile, JSON.stringify(emptyFileV2(), null, 2), 'utf8');
    await addFileToRegistry(secondaryRoot, destFile);

    const result = await handleGroupMoveFile(ctx, { sourceFile, destFile, groupId });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);

    // Group moved: dest has it, source doesn't.
    const destData = await readFileAt(destFile);
    const sourceData = await readFileAt(sourceFile);
    expect(destData.groups.some(g => g.id === groupId)).toBe(true);
    expect(sourceData.groups.some(g => g.id === groupId)).toBe(false);
  });

  it('handleGroupMoveFile emits 1-based tagInsertions when the destination uses tag anchors (SML-1522)', async () => {
    // Real source file the point anchor resolves against: 0-based line 2 is the function.
    const codeFile = path.join(secondaryRoot, 'src', 'insert.ts');
    await fs.mkdir(path.dirname(codeFile), { recursive: true });
    await fs.writeFile(
      codeFile,
      ['import { foo } from "bar";', '', 'export function test() {', '  return 42;', '}'].join('\n'),
      'utf8'
    );

    const sourceFile = path.join(secondaryRoot, '.bookmarks', 'shared', 'ins-source.json');
    const destFile = path.join(secondaryRoot, '.bookmarks', 'shared', 'ins-dest.json');
    const groupId = await setupGroupInWorkspace(secondaryRoot, sourceFile, 'Movable');

    // Add a point-anchored bookmark to the moved group, targeting the real source file.
    const srcData: any = await readFileAt(sourceFile);
    srcData.bookmarks.push({
      id: 'bm-point',
      fileId: srcData.fileId,
      groupId,
      target: { uri: 'src/insert.ts' },
      anchor: { kind: 'point', line: 2, lineCache: 'export function test() {' },
      label: 'x',
      createdAt: 1,
    });
    await fs.writeFile(sourceFile, JSON.stringify(srcData, null, 2), 'utf8');

    // Destination configured for tag anchors → forces a point→tag conversion (tag insertion).
    const destData: any = emptyFileV2();
    destData.defaultAnchorType = 'tag';
    await fs.writeFile(destFile, JSON.stringify(destData, null, 2), 'utf8');
    await addFileToRegistry(secondaryRoot, destFile);

    const result = await handleGroupMoveFile(ctx, { sourceFile, destFile, groupId });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.agentActionRequired).toBe(true);
    expect(parsed.tagInsertions).toHaveLength(1);
    // Core resolves to 0-based line 2; the MCP wire convention is 1-based, so this must be 3.
    expect(parsed.tagInsertions[0].line).toBe(3);
  });

  it('handleGroupMoveFile emits 1-based tagRemovals when converting away from tag anchors (SML-1522)', async () => {
    // Source file carries the tag marker on 0-based line 2 so the tag anchor resolves there.
    const codeFile = path.join(secondaryRoot, 'src', 'remove.ts');
    await fs.mkdir(path.dirname(codeFile), { recursive: true });
    await fs.writeFile(
      codeFile,
      [
        'import { foo } from "bar";',
        '',
        'export function test() { // @bookmark:test123',
        '  return 42;',
        '}',
      ].join('\n'),
      'utf8'
    );

    const sourceFile = path.join(secondaryRoot, '.bookmarks', 'shared', 'rem-source.json');
    const destFile = path.join(secondaryRoot, '.bookmarks', 'shared', 'rem-dest.json');
    const groupId = await setupGroupInWorkspace(secondaryRoot, sourceFile, 'Taggable');

    // Add a tag-anchored bookmark to the moved group.
    const srcData: any = await readFileAt(sourceFile);
    srcData.bookmarks.push({
      id: 'bm-tag',
      fileId: srcData.fileId,
      groupId,
      target: { uri: 'src/remove.ts' },
      anchor: { kind: 'tag', tagId: 'test123', lastUpdatedLine: 2, nonce: 0 },
      label: 'x',
      createdAt: 1,
    });
    await fs.writeFile(sourceFile, JSON.stringify(srcData, null, 2), 'utf8');

    // Destination uses smart anchors → forces a tag→smart conversion (tag removal).
    const destData: any = emptyFileV2();
    destData.defaultAnchorType = 'smart';
    await fs.writeFile(destFile, JSON.stringify(destData, null, 2), 'utf8');
    await addFileToRegistry(secondaryRoot, destFile);

    const result = await handleGroupMoveFile(ctx, { sourceFile, destFile, groupId });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.tagRemovals).toHaveLength(1);
    expect(parsed.tagRemovals[0].pattern).toBe('@bookmark:test123');
    // Core resolves to 0-based line 2; the MCP wire convention is 1-based, so this must be 3.
    expect(parsed.tagRemovals[0].line).toBe(3);
  });

  it('handleGroupDelete falls back to ctx.workspaceRoot in a single-workspace setup', async () => {
    const root = mkRoot('single');
    await fs.mkdir(root, { recursive: true });
    await readRegistry(root);
    const singleCtx: any = {
      workspaceRoot: root,
      workspaces: [createWorkspaceInfo(root)],
    };

    const absFile = path.join(root, '.bookmarks', 'shared', 'shared.json');
    const groupId = await setupGroupInWorkspace(root, absFile, 'Solo');

    const before = await readRegistry(root);
    expect(before.nameIndex['Solo']).toBeTruthy();

    await handleGroupDelete(singleCtx, { filePath: absFile, groupId });

    const after = await readRegistry(root);
    expect(after.nameIndex['Solo']).toBeUndefined();

    await fs.rm(root, { recursive: true, force: true });
  });
});
