// ABOUTME: Tests for handleAnchorValidate — verifies the summary's valid/warning/broken
// ABOUTME: counts come from the core classifyAnchorStatus (parity with anchor_listBroken / the extension).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { handleAnchorValidate } from './anchor-repair';
import {
  createWorkspaceInfo,
  emptyFileV2,
  addFileToRegistry,
  readRegistry,
  writeRegistry,
  createAnchor,
  type WorkspaceInfo,
} from '@agentic-bookmarks/core';

describe('handleAnchorValidate summary classification', () => {
  let testDir: string;
  let ws: WorkspaceInfo;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `anchor-validate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(testDir, { recursive: true });
    await readRegistry(testDir); // materialize registry on disk
    ws = createWorkspaceInfo(testDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  function makeCtx() {
    return {
      workspaces: [ws],
      workspaceRoot: ws.workspaceRoot,
      lastInitMeta: null,
      lastInitRootUris: undefined,
      hasServedRepairSkillGuide: false,
    } as any;
  }

  /** Write `lines` to a source file at workspace-relative `relPath`. */
  async function writeSource(relPath: string, lines: string[]): Promise<string> {
    const abs = path.join(testDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, lines.join('\n'), 'utf8');
    return abs;
  }

  /**
   * Register a v2 bookmarks file (under .bookmarks/shared/ → resolved as shared/non-local)
   * containing the given bookmarks. Each anchor is minted via createAnchor('smart', ...) so the
   * test controls how it resolves against the on-disk source content. `anchorIsLocal:true` makes
   * creation capture surrounding context (shared creation captures none), independent of the
   * file's resolution-time isLocal (false, because it lives under .bookmarks/shared/).
   */
  async function registerBookmarksFile(
    bookmarks: Array<{ id: string; targetRel: string; anchorLines: string[]; line: number; anchorIsLocal?: boolean }>,
    dataFileName: string = 'bookmarks.json',
  ): Promise<void> {
    const file = emptyFileV2();
    const groupId = file.groups[0].id;
    file.bookmarks = bookmarks.map(b => ({
      id: b.id,
      fileId: file.fileId,
      groupId,
      target: { uri: b.targetRel },
      anchor: createAnchor('smart', b.anchorLines, b.line, { lineCacheLength: 120, isLocal: b.anchorIsLocal ?? false }),
      label: '',
      createdAt: 1000,
      updatedAt: 2000,
    })) as any;

    const dataPath = path.join(testDir, '.bookmarks', 'shared', dataFileName);
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(file, null, 2), 'utf8');
    await addFileToRegistry(testDir, dataPath);
  }

  async function setShowWarningOnShared(value: boolean): Promise<void> {
    const reg = await readRegistry(testDir);
    reg.settings = reg.settings ?? ({} as any);
    (reg.settings as any).anchors = { ...((reg.settings as any).anchors ?? {}), showWarningOnShared: value };
    await writeRegistry(testDir, reg);
  }

  async function validate(uri: string) {
    const result = await handleAnchorValidate(makeCtx(), { uri });
    return JSON.parse(result.content[0].text);
  }

  // A smart anchor that RESOLVES with a deterministic warning-band score (>=0.6, <0.85). The
  // unique main line is kept in place on disk (so it resolves in the rigid phase, independent of
  // flex gating), but exactly half of the captured context (2 of 4 before, 2 of 4 after) is
  // changed in place. Score = 0.5*mainLineScore(1) + 0.5*contextCombined(4/8=0.5) = 0.75.
  // (createAnchor isLocal:true captures LOCAL_CONTEXT_MIN=4 lines each side; the unique lineCache
  // means no disambiguation expansion, so exactly 4+4 are captured.)
  const LOWSCORE_ANCHOR_LINES = [
    'before_aaa',
    'before_bbb',
    'before_ccc',
    'before_ddd',
    'TARGET_unique_line_zzz',
    'after_eee',
    'after_fff',
    'after_ggg',
    'after_hhh',
  ];
  const LOWSCORE_TARGET_IDX = 4;
  const LOWSCORE_DISK_LINES = [
    'before_aaa',            // keep
    'CHANGED_before_one',    // changed
    'before_ccc',            // keep
    'CHANGED_before_two',    // changed
    'TARGET_unique_line_zzz', // keep — unique main line, resolves here
    'after_eee',            // keep
    'CHANGED_after_one',    // changed
    'after_ggg',            // keep
    'CHANGED_after_two',    // changed
  ];

  it('counts a cleanly resolved anchor as valid (positive control)', async () => {
    const lines = ['alpha', 'const target = compute();', 'beta'];
    await writeSource('src/clean.ts', lines);
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/clean.ts', anchorLines: lines, line: 1, anchorIsLocal: true },
    ]);

    const parsed = await validate('src/clean.ts');
    expect(parsed.success).toBe(true);
    expect(parsed.results[0].resolved).toBe(true);
    expect(parsed.results[0].status).toBe('valid');
    expect(parsed.summary).toMatchObject({ total: 1, valid: 1, warning: 0, broken: 0 });
  });

  it('counts a fully unresolvable anchor (no lineCacheOnly) as broken (positive control)', async () => {
    const anchorLines = ['one', 'const uniqueTargetXYZ = compute();', 'two'];
    // Disk content is unrelated AND never contains the lineCache line → not lineCacheOnly.
    const diskLines = ['totally', 'unrelated', 'content', 'here'];
    await writeSource('src/broken.ts', diskLines);
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/broken.ts', anchorLines, line: 1, anchorIsLocal: true },
    ]);

    const parsed = await validate('src/broken.ts');
    expect(parsed.results[0].resolved).toBe(false);
    expect(parsed.results[0].status).toBe('broken');
    expect(parsed.summary).toMatchObject({ total: 1, valid: 0, warning: 0, broken: 1 });
  });

  // Divergence #1: an unresolved anchor whose lineCache is unique but whose context is out of
  // flex range is 'warning' (deep-flex pending), NOT 'broken'. The pre-fix hardcoded summary
  // counted every !resolved anchor as broken.
  it('counts an unresolved lineCacheOnly anchor as warning, not broken', async () => {
    const anchorLines = ['ctx before 0', 'target line', 'ctx after 0'];
    // 10 lines inserted on each side push the captured context beyond the flex window of 5,
    // so the anchor can't resolve — but its unique lineCache line is still found (lineCacheOnly).
    const diskLines = [
      'ctx before 0',
      'ins0', 'ins1', 'ins2', 'ins3', 'ins4', 'ins5', 'ins6', 'ins7', 'ins8', 'ins9',
      'target line',
      'ins10', 'ins11', 'ins12', 'ins13', 'ins14', 'ins15', 'ins16', 'ins17', 'ins18', 'ins19',
      'ctx after 0',
    ];
    await writeSource('src/linecache.ts', diskLines);
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/linecache.ts', anchorLines, line: 1, anchorIsLocal: true },
    ]);

    const parsed = await validate('src/linecache.ts');
    expect(parsed.results[0].resolved).toBe(false);
    expect(parsed.results[0].status).toBe('warning');
    expect(parsed.summary).toMatchObject({ total: 1, valid: 0, warning: 1, broken: 0 });
  });

  // Divergence #2: a resolved low-score SHARED (non-local) bookmark is suppressed to 'valid'
  // unless showWarningOnShared is set. The pre-fix hardcoded summary counted every resolved
  // low-score anchor as warning regardless of shared/local.
  it('suppresses a resolved low-score shared anchor to valid by default', async () => {
    await writeSource('src/shared-flex.ts', LOWSCORE_DISK_LINES);
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/shared-flex.ts', anchorLines: LOWSCORE_ANCHOR_LINES, line: LOWSCORE_TARGET_IDX, anchorIsLocal: true },
    ]);
    // No settings written → showWarningOnShared defaults to false; the data file lives under
    // .bookmarks/shared/ → resolved as non-local.

    const parsed = await validate('src/shared-flex.ts');
    expect(parsed.results[0].resolved).toBe(true);
    expect(parsed.results[0].score).toBeLessThan(0.85);
    expect(parsed.results[0].status).toBe('valid');
    expect(parsed.summary).toMatchObject({ total: 1, valid: 1, warning: 0, broken: 0 });
  });

  it('counts a resolved low-score shared anchor as warning when showWarningOnShared is true', async () => {
    await writeSource('src/shared-flex2.ts', LOWSCORE_DISK_LINES);
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/shared-flex2.ts', anchorLines: LOWSCORE_ANCHOR_LINES, line: LOWSCORE_TARGET_IDX, anchorIsLocal: true },
    ]);
    await setShowWarningOnShared(true);

    const parsed = await validate('src/shared-flex2.ts');
    expect(parsed.results[0].resolved).toBe(true);
    expect(parsed.results[0].status).toBe('warning');
    expect(parsed.summary).toMatchObject({ total: 1, valid: 0, warning: 1, broken: 0 });
  });

  it('returns an all-zero summary when the file has no bookmarks', async () => {
    // File exists on disk but nothing targets it → early return, no classification.
    await writeSource('src/untracked.ts', ['just', 'some', 'lines']);

    const parsed = await validate('src/untracked.ts');
    expect(parsed.success).toBe(true);
    expect(parsed.results).toEqual([]);
    expect(parsed.summary).toEqual({ total: 0, valid: 0, warning: 0, broken: 0 });
  });

  it('returns success:false when the source file is missing (error path)', async () => {
    const parsed = await validate('src/does-not-exist.ts');
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('File not found');
  });
});
