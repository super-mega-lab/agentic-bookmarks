// ABOUTME: Tests for handleAnchorRepair — covers SML-1545: a repaired range
// ABOUTME: anchor collapses to a point and the response reports the resulting kind.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  createWorkspaceInfo,
  emptyFileV2,
  addFileToRegistry,
  readFileAt,
  createAnchor,
} from '@agentic-bookmarks/core';
import { handleAnchorRepair } from './anchor-repair';

describe('handleAnchorRepair', () => {
  let testDir: string;
  let ctx: any;

  const sourceLines = ['line 0', 'line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6'];

  beforeEach(async () => {
    testDir = path.join(
      tmpdir(),
      `anchor-repair-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    await fs.mkdir(testDir, { recursive: true });
    ctx = {
      workspaceRoot: testDir,
      workspaces: [createWorkspaceInfo(testDir)],
      lastInitMeta: null,
      lastInitRootUris: undefined,
      hasServedRepairSkillGuide: false,
    };
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  /**
   * Write a bookmarks file containing one bookmark with `anchor`, register it,
   * and write the target source file. Returns the bookmarks file's absolute path.
   */
  async function setupBookmark(bookmarkId: string, anchor: any): Promise<string> {
    const fileData: any = emptyFileV2({ isLocal: true });
    const absFilePath = path.join(testDir, '.bookmarks', 'shared', 'shared.json');
    await fs.mkdir(path.dirname(absFilePath), { recursive: true });

    fileData.bookmarks.push({
      id: bookmarkId,
      fileId: fileData.fileId,
      groupId: fileData.groups[0].id,
      target: { uri: 'src/test.ts' },
      anchor,
      label: 'Test Bookmark',
      createdAt: Date.now(),
    });

    await fs.writeFile(absFilePath, JSON.stringify(fileData, null, 2), 'utf8');
    await addFileToRegistry(testDir, absFilePath);

    const sourceFile = path.join(testDir, 'src', 'test.ts');
    await fs.mkdir(path.dirname(sourceFile), { recursive: true });
    await fs.writeFile(sourceFile, sourceLines.join('\n'), 'utf8');

    return absFilePath;
  }

  it('collapses a repaired range anchor to a point and reports the resulting kind', async () => {
    // Range anchor: 0-based line 2 to line 4.
    const rangeAnchor = createAnchor('range', sourceLines, 2, {}, 4);
    const absFilePath = await setupBookmark('bm-range-1', rangeAnchor);

    const result = await handleAnchorRepair(ctx, {
      repairs: [{ bookmarkId: 'bm-range-1', newLine: 6 }], // wire 6 → internal 5
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.repaired).toHaveLength(1);
    expect(parsed.failed).toHaveLength(0);

    const entry = parsed.repaired[0];
    expect(entry.bookmarkId).toBe('bm-range-1');
    expect(entry.newLine).toBe(6);
    expect(entry.anchorKind).toBe('point'); // the FIX — was 'range'
    expect(entry.rangeCollapsed).toBe(true);

    const persisted = await readFileAt(absFilePath);
    const repaired = persisted.bookmarks.find(b => b.id === 'bm-range-1');
    expect(repaired!.anchor.kind).toBe('point');
    expect((repaired!.anchor as any).line).toBe(5); // 0-based internal
  });

  it('reports point kind without a rangeCollapsed flag when repairing a point anchor', async () => {
    const pointAnchor = createAnchor('point', sourceLines, 3, { lineCacheLength: 120 });
    const absFilePath = await setupBookmark('bm-point-1', pointAnchor);

    const result = await handleAnchorRepair(ctx, {
      repairs: [{ bookmarkId: 'bm-point-1', newLine: 6 }],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.repaired).toHaveLength(1);

    const entry = parsed.repaired[0];
    expect(entry.anchorKind).toBe('point');
    expect(entry.rangeCollapsed).toBeUndefined();

    const persisted = await readFileAt(absFilePath);
    const repaired = persisted.bookmarks.find(b => b.id === 'bm-point-1');
    expect(repaired!.anchor.kind).toBe('point');
  });

  it('preserves the smart kind and does not set rangeCollapsed when repairing a smart anchor', async () => {
    const smartAnchor = createAnchor('smart', sourceLines, 2, { isLocal: true, lineCacheLength: 120 });
    const absFilePath = await setupBookmark('bm-smart-1', smartAnchor);

    const result = await handleAnchorRepair(ctx, {
      repairs: [{ bookmarkId: 'bm-smart-1', newLine: 6 }],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.repaired).toHaveLength(1);

    const entry = parsed.repaired[0];
    expect(entry.anchorKind).toBe('smart');
    expect(entry.rangeCollapsed).toBeUndefined();

    const persisted = await readFileAt(absFilePath);
    const repaired = persisted.bookmarks.find(b => b.id === 'bm-smart-1');
    expect(repaired!.anchor.kind).toBe('smart');
  });
});
