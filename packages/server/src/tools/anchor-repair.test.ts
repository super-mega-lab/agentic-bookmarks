// ABOUTME: Tests for the anchor-repair tool handlers. handleAnchorRepair (SML-1545): a repaired
// ABOUTME: range anchor collapses to a point and the response reports the resulting kind.
// ABOUTME: handleAnchorValidate (SML-1544): the summary's valid/warning/broken counts come from
// ABOUTME: the core classifyAnchorStatus (parity with anchor_listBroken / the extension).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  createWorkspaceInfo,
  emptyFileV2,
  addFileToRegistry,
  readRegistry,
  writeRegistry,
  readFileAt,
  createAnchor,
  type WorkspaceInfo,
} from '@agentic-bookmarks/core';
import { handleAnchorRepair, handleAnchorValidate, handleAnchorGetRepairPackage } from './anchor-repair';

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

  async function setEnableFlexContextShared(value: boolean): Promise<void> {
    const reg = await readRegistry(testDir);
    reg.settings = reg.settings ?? ({} as any);
    (reg.settings as any).anchors = { ...((reg.settings as any).anchors ?? {}), enableFlexContextShared: value };
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

  // A smart anchor that resolves ONLY via flex (rigid contiguous-context match fails, windowed
  // flex succeeds): two non-matching lines inserted on BOTH sides of the target break the rigid
  // match but stay within the flex window. Mirrors the SML-1508 listBroken fixture
  // (anchor-git-tools.test.ts:645). Created with anchorIsLocal:true so it carries context;
  // resolution-time isLocal is independent (false, from living under .bookmarks/shared/).
  const FLEXONLY_ANCHOR_LINES = [
    'alpha_unique_marker_aaa',
    'beta_unique_marker_bbb',
    'gamma_unique_marker_ccc',
    'delta_unique_marker_ddd',
    'TARGET_unique_line_zzz',
    'epsilon_unique_marker_eee',
    'zeta_unique_marker_fff',
    'eta_unique_marker_ggg',
    'theta_unique_marker_hhh',
  ];
  const FLEXONLY_TARGET_IDX = 4;
  const FLEXONLY_DISK_LINES = [
    'alpha_unique_marker_aaa',
    'beta_unique_marker_bbb',
    'gamma_unique_marker_ccc',
    'delta_unique_marker_ddd',
    'inserted_before_one',
    'inserted_before_two',
    'TARGET_unique_line_zzz',
    'inserted_after_one',
    'inserted_after_two',
    'epsilon_unique_marker_eee',
    'zeta_unique_marker_fff',
    'eta_unique_marker_ggg',
    'theta_unique_marker_hhh',
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

  // Parity guarantee (SML-1555): validate must resolve a shared flex-only anchor the same way
  // anchor_listBroken (anchor-git-tools.test.ts:645) and the extension do. The anchor resolves
  // ONLY via flex — two non-matching lines inserted on BOTH sides of the target break the rigid
  // contiguous context match (Phase-1 fails) but stay within the flex window (Phase-2 succeeds).
  // With enableFlexContextShared:false the flex gate is shouldFlex = enableFlex && (isLocal ||
  // enableFlexShared). Pre-fix, validate resolves shared anchors with the per-file isLocal:false →
  // gate OFF → flex skipped → the anchor is reported broken. Post-fix, validate resolves with
  // isLocal:true (matching listBroken/UI) → gate ON → the anchor resolves → not broken.
  it('resolves a shared flex-only anchor (not broken) under enableFlexContextShared:false, matching anchor_listBroken (SML-1555)', async () => {
    await writeSource('src/flexshared.ts', FLEXONLY_DISK_LINES);
    // registerBookmarksFile writes under .bookmarks/shared/ → resolution-time isLocal:false.
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/flexshared.ts', anchorLines: FLEXONLY_ANCHOR_LINES, line: FLEXONLY_TARGET_IDX, anchorIsLocal: true },
    ]);
    await setEnableFlexContextShared(false);

    const parsed = await validate('src/flexshared.ts');
    expect(parsed.results[0].resolved).toBe(true);
    expect(parsed.results[0].status).not.toBe('broken');
    expect(parsed.summary.broken).toBe(0);
    expect(parsed.summary.total).toBe(1);
  });

  // Sibling parity guarantee (SML-1555): handleAnchorGetRepairPackage resolves with the same
  // isLocal:true as validate/listBroken, so under enableFlexContextShared:false it does NOT
  // package a shared flex-only anchor the product considers fine. Pre-fix it resolved with the
  // per-file isLocal:false → flex gate OFF → the anchor was reported broken and packaged for
  // repair (summary.broken:1, packages:[1]). Post-fix it resolves → not broken → not packaged.
  it('does not package a shared flex-only anchor under enableFlexContextShared:false (getRepairPackage parity, SML-1555)', async () => {
    await writeSource('src/flexshared-rp.ts', FLEXONLY_DISK_LINES);
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/flexshared-rp.ts', anchorLines: FLEXONLY_ANCHOR_LINES, line: FLEXONLY_TARGET_IDX, anchorIsLocal: true },
    ]);
    await setEnableFlexContextShared(false);

    const result = await handleAnchorGetRepairPackage(makeCtx(), { uri: 'src/flexshared-rp.ts' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.summary.total).toBe(1);
    expect(parsed.summary.broken).toBe(0);
    expect(parsed.packages).toHaveLength(0);
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
