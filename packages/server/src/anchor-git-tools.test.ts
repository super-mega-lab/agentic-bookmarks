import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { getRepairSkillGuide, findHistoricalCommit, handleSearchMovedCode } from './anchor-git-tools';
import { handleAnchorListBroken } from './tools/anchor-git';
import {
  createWorkspaceInfo,
  emptyFileV2,
  addFileToRegistry,
  readRegistry,
  writeRegistry,
  createAnchor,
  getBookmarksDataRoot,
  getCacheDir,
  brokenAnchorsCache,
  type WorkspaceInfo,
} from '@agentic-bookmarks/core';

describe('getRepairSkillGuide', () => {
  it('returns guide string with no options', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('# Anchor Repair Guide');
    expect(guide).toContain('Repair Waterfall');
  });

  it('includes Supplemental Evidence section', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('## Supplemental Evidence');
    expect(guide).toContain('Clue roles by waterfall step');
  });

  it('declares 1-based line-number convention', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('## Line Numbers');
    expect(guide).toContain('1-based');
    expect(guide).toContain('grep -n');
  });

  it('includes rationalization guard in Rules', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('It never replaces the waterfall');
  });

  it('includes inline clue note at Step 1', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('do not treat label/note as a search query');
  });

  it('includes inline clue note at Step 2', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('both old and current surrounding content');
  });

  it('includes inline clue note at Step 3', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('shifted` diagnosis is already high confidence');
  });

  it('includes inline clue note at Steps 4-5', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('supplemental context for assessing whether a candidate makes sense');
  });

  it('includes inline clue note at Step 6', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('Label and note can guide your exploration');
  });

  it('includes Step 7 balancing language', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('code was explicitly deleted or the concept removed');
  });

  it('defaults to confirmLowConfidenceRepairs=true (prompt user)', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('ask whether they want to repair there');
  });

  it('uses summary wording when confirmLowConfidenceRepairs=false', () => {
    const guide = getRepairSkillGuide({ confirmLowConfidenceRepairs: false });
    expect(guide).toContain('note the possible alternative location in your summary');
    expect(guide).not.toContain('ask whether they want to repair there');
  });

  it('omits Contradiction Detection by default', () => {
    const guide = getRepairSkillGuide();
    expect(guide).not.toContain('Contradiction Detection');
  });

  it('includes Contradiction Detection when suggestBookmarkRelocation=true', () => {
    const guide = getRepairSkillGuide({ suggestBookmarkRelocation: true });
    expect(guide).toContain('## Contradiction Detection');
    expect(guide).toContain('Suggest only, never auto-relocate');
  });

  it('supports both options active simultaneously', () => {
    const guide = getRepairSkillGuide({ suggestBookmarkRelocation: true, confirmLowConfidenceRepairs: false });
    expect(guide).toContain('## Contradiction Detection');
    expect(guide).toContain('note the possible alternative location in your summary');
    expect(guide).not.toContain('ask whether they want to repair there');
  });

  it('includes waterfall sequencing discipline', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('Do not call the next waterfall step');
  });

  it('includes post-repair validation caveat', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('Post-repair validation only confirms');
  });

  it('Step 0 includes ID-lookup path for specific bookmark by ID', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('bookmark by ID');
    expect(guide).toContain('bookmark_list({"query":"<bookmarkId>"})');
  });

  it('Step 0 includes general broken-list path', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('anchor_listBroken');
    expect(guide).toContain('fix broken bookmarks generally');
  });

  it('defaults to serial one-at-a-time multi-bookmark rule', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('one at a time');
    expect(guide).toContain('whatever tracking your environment provides');
    expect(guide).not.toContain('sub-agents');
  });

  it('uses parallel multi-bookmark rule when encourageParallelFixes=true', () => {
    const guide = getRepairSkillGuide({ encourageParallelFixes: true });
    expect(guide).toContain('sub-agents');
    expect(guide).toContain('full waterfall independently');
    expect(guide).not.toContain('one at a time');
  });

  it('preserves existing waterfall structure', () => {
    const guide = getRepairSkillGuide();
    expect(guide).toContain('0. **Awareness Check**');
    expect(guide).toContain('1. **Quick Look**');
    expect(guide).toContain('2. **Historical Context**');
    expect(guide).toContain('3. **Diff Analysis**');
    expect(guide).toContain('4. **Cross-File Search**');
    expect(guide).toContain('5. **Line Tracing**');
    expect(guide).toContain('6. **Manual Investigation**');
    expect(guide).toContain('7. **Declare Non-Repairable**');
  });
});

// Mock the core package namespaces used by findHistoricalCommit and handleSearchMovedCode
const {
  mockValidateGitContext,
  mockFindBaselineCommit,
  mockGetCommitLog,
  mockGetDiffBetweenCommits,
  mockSearchForMovedCode,
} = vi.hoisted(() => ({
  mockValidateGitContext: vi.fn(),
  mockFindBaselineCommit: vi.fn(),
  mockGetCommitLog: vi.fn(),
  mockGetDiffBetweenCommits: vi.fn(),
  mockSearchForMovedCode: vi.fn(),
}));

vi.mock('@agentic-bookmarks/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentic-bookmarks/core')>();
  return {
    ...actual,
    gitHistory: {
      ...actual.gitHistory,
      validateGitContext: mockValidateGitContext,
      getCommitLog: mockGetCommitLog,
      getDiffBetweenCommits: mockGetDiffBetweenCommits,
    },
    anchorForensics: {
      ...actual.anchorForensics,
      findBaselineCommit: mockFindBaselineCommit,
    },
    anchorRepair: {
      ...actual.anchorRepair,
      searchForMovedCode: mockSearchForMovedCode,
    },
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const os = await import('node:os');
  const realRoot = os.tmpdir();
  // Real reads for on-disk fixtures under tmpdir (handleAnchorListBroken tests);
  // canned content for the synthetic /fake/repo paths the git-tools tests use.
  const readFile = vi.fn((p: any, ...rest: any[]) => {
    if (typeof p === 'string' && p.startsWith(realRoot)) {
      return (actual.readFile as any)(p, ...rest);
    }
    return Promise.resolve('line0\nline1\nline2\nline3\nline4\nline5\n');
  });
  return {
    ...actual,
    readFile,
  };
});

describe('findHistoricalCommit', () => {
  it('returns enriched error detail when baseline discovery fails', async () => {
    mockValidateGitContext.mockResolvedValue({
      valid: true,
      repoRoot: '/fake/repo',
    });
    mockFindBaselineCommit.mockResolvedValue({
      commit: null,
      source: null,
      tried: ['json-blame', 'commit-search'],
      lastUpdatedLine: 42,
      lineCachePreview: 'const foo = bar();',
    });

    const result = await findHistoricalCommit(
      '/fake/repo', 'src/file.ts', 42,
      '/fake/repo/.bookmarks/data.json', 'bm-123',
      'const foo = bar();',
    );

    expect(result).toHaveProperty('error', 'Could not find baseline commit for anchor');
    expect(result).toHaveProperty('detail');
    const detail = (result as any).detail;
    expect(detail.strategiesAttempted).toEqual(['json-blame', 'commit-search']);
    expect(detail.lastUpdatedLine).toBe(42);
    expect(detail.lineCachePreview).toBe('const foo = bar();');
    expect(detail.commitSearchDepth).toBe(20);
    expect(detail.hint).toContain('search the current codebase');
  });

  it('passes enableBaselinePickaxe option through to findBaselineCommit', async () => {
    mockValidateGitContext.mockResolvedValue({
      valid: true,
      repoRoot: '/fake/repo',
    });
    mockFindBaselineCommit.mockResolvedValue({
      commit: null,
      source: null,
      tried: ['json-blame', 'commit-search', 'pickaxe'],
      lastUpdatedLine: 10,
      lineCachePreview: 'return x;',
    });

    await findHistoricalCommit(
      '/fake/repo', 'src/file.ts', 10,
      '/fake/repo/.bookmarks/data.json', 'bm-456',
      'return x;',
      { enableBaselinePickaxe: true },
    );

    expect(mockFindBaselineCommit).toHaveBeenCalledWith(
      '/fake/repo',
      '/fake/repo/.bookmarks/data.json',
      'bm-456',
      'src/file.ts',
      10,
      'return x;',
      { enableBaselinePickaxe: true },
    );
  });
});

describe('handleSearchMovedCode', () => {
  const fakeBookmark = {
    id: 'bm-789',
    label: 'test bookmark',
    target: { uri: 'src/old.ts' },
    anchor: {
      kind: 'smart' as const,
      lineCache: 'const result = compute();',
      lastUpdatedLine: 10,
      contextBefore: ['// setup'],
      contextAfter: ['return result;'],
      nonce: 'abc',
    },
  };

  function setupMocksForSearchMovedCode(fuzzyHints?: any[]) {
    mockValidateGitContext.mockResolvedValue({
      valid: true,
      repoRoot: '/fake/repo',
    });
    mockFindBaselineCommit.mockResolvedValue({
      commit: 'abc123',
      source: 'json-blame',
      tried: ['json-blame'],
    });
    mockGetCommitLog.mockResolvedValue([
      { hash: 'abc123', date: new Date('2025-01-01'), subject: 'initial commit' },
    ]);
    mockGetDiffBetweenCommits.mockResolvedValue([]);
    mockSearchForMovedCode.mockReturnValue({
      searchedText: 'const result = compute();',
      filesSearched: 0,
      matches: [],
      fuzzyHints,
    });
  }

  it('includes fuzzyHintsNote when fuzzyHints are present', async () => {
    setupMocksForSearchMovedCode([
      {
        file: 'src/new.ts',
        line: 5,
        matchType: 'token-fuzzy',
        similarity: 0.45,
        content: 'const res = compute();',
        context: [],
      },
    ]);

    const result = await handleSearchMovedCode(
      fakeBookmark as any,
      '/fake/repo',
      'src/old.ts',
      '/fake/repo/.bookmarks/data.json',
    );

    expect(result.success).toBe(true);
    expect(result.fuzzyHints).toBeDefined();
    expect((result.fuzzyHints as any[]).length).toBe(1);
    expect((result.fuzzyHints as any[])[0].matchType).toBe('token-fuzzy');
    expect(result.fuzzyHintsNote).toBe(
      'Fuzzy hints are approximate matches based on shared tokens or surrounding context. You must scrutinize these carefully — they may be unrelated code.',
    );
  });

  it('omits fuzzyHints and fuzzyHintsNote when no fuzzy matches', async () => {
    setupMocksForSearchMovedCode(undefined);

    const result = await handleSearchMovedCode(
      fakeBookmark as any,
      '/fake/repo',
      'src/old.ts',
      '/fake/repo/.bookmarks/data.json',
    );

    expect(result.success).toBe(true);
    expect(result.fuzzyHints).toBeUndefined();
    expect(result.fuzzyHintsNote).toBeUndefined();
  });

  it('passes language and context to searchForMovedCode', async () => {
    setupMocksForSearchMovedCode(undefined);

    await handleSearchMovedCode(
      fakeBookmark as any,
      '/fake/repo',
      'src/old.ts',
      '/fake/repo/.bookmarks/data.json',
    );

    expect(mockSearchForMovedCode).toHaveBeenCalledWith(
      'const result = compute();',
      expect.any(Map),
      expect.objectContaining({
        language: 'typescript',
        contextBefore: ['// setup'],
        contextAfter: ['return result;'],
      }),
    );
  });
});

describe('handleAnchorListBroken', () => {
  let testDir: string;
  let ws: WorkspaceInfo;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `list-broken-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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
   * Register a v2 bookmarks file containing the given bookmarks. Each bookmark's
   * anchor is minted with `createAnchor('smart', anchorLines, line)` so we can
   * control whether it resolves against the on-disk source content.
   */
  async function registerBookmarksFile(
    bookmarks: Array<{ id: string; targetRel: string; anchorLines: string[]; line: number; updatedAt: number; anchorIsLocal?: boolean }>,
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
      updatedAt: b.updatedAt,
    })) as any;

    const dataPath = path.join(testDir, '.bookmarks', 'shared', dataFileName);
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(file, null, 2), 'utf8');
    await addFileToRegistry(testDir, dataPath);
  }

  /** Write the broken-anchors cache the same way the extension would. */
  async function writeCache(
    entries: brokenAnchorsCache.BrokenAnchorEntry[],
    coveredUris: string[],
  ): Promise<void> {
    const registry = await readRegistry(testDir);
    const cacheDir = getCacheDir(testDir, getBookmarksDataRoot(registry));
    await brokenAnchorsCache.writeBrokenAnchorsCache(cacheDir, entries, coveredUris);
  }

  async function callAndParse(args: any = {}) {
    const result = await handleAnchorListBroken(makeCtx(), args);
    return JSON.parse(result.content[0].text);
  }

  it('evicts a now-clean entry when file mtime > discoveredAt', async () => {
    const lines = ['line a', 'const target = compute();', 'line c'];
    const abs = await writeSource('src/file.ts', lines);
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/file.ts', anchorLines: lines, line: 1, updatedAt: 500 },
    ]);
    // Cache says broken, discovered in the past.
    await writeCache(
      [{ bookmarkId: 'bm1', uri: 'src/file.ts', status: 'broken', errorCode: 'not_found', errorDetails: null, score: null, discoveredAt: 1000 }],
      ['src/file.ts'],
    );
    // File mtime newer than discoveredAt → forces re-check; anchor resolves clean → evicted.
    const newer = new Date(5_000_000);
    await fs.utimes(abs, newer, newer);

    const parsed = await callAndParse();
    expect(parsed.summary.broken).toBe(0);
    const allEntries = parsed.results.flatMap((r: any) => r.entries);
    expect(allEntries.some((e: any) => e.bookmarkId === 'bm1')).toBe(false);
  });

  it('evicts a now-clean entry when bookmark.updatedAt > discoveredAt (repair path)', async () => {
    const lines = ['alpha', 'const target = compute();', 'beta'];
    const abs = await writeSource('src/file.ts', lines);
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/file.ts', anchorLines: lines, line: 1, updatedAt: 9000 },
    ]);
    await writeCache(
      [{ bookmarkId: 'bm1', uri: 'src/file.ts', status: 'broken', errorCode: 'not_found', errorDetails: null, score: null, discoveredAt: 5000 }],
      ['src/file.ts'],
    );
    // File mtime OLDER than discoveredAt, but bookmark.updatedAt (9000) > discoveredAt (5000)
    // → updatedAt clause forces re-check; anchor resolves clean → evicted.
    const older = new Date(1000);
    await fs.utimes(abs, older, older);

    const parsed = await callAndParse();
    expect(parsed.summary.broken).toBe(0);
    const allEntries = parsed.results.flatMap((r: any) => r.entries);
    expect(allEntries.some((e: any) => e.bookmarkId === 'bm1')).toBe(false);
  });

  it('keeps a still-broken entry on read', async () => {
    const anchorLines = ['one', 'const target = compute();', 'two'];
    // On-disk content is COMPLETELY different so the smart anchor cannot resolve.
    const diskLines = ['totally', 'unrelated', 'content', 'here'];
    const abs = await writeSource('src/file.ts', diskLines);
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/file.ts', anchorLines, line: 1, updatedAt: 500 },
    ]);
    await writeCache(
      [{ bookmarkId: 'bm1', uri: 'src/file.ts', status: 'broken', errorCode: 'not_found', errorDetails: null, score: null, discoveredAt: 1000 }],
      ['src/file.ts'],
    );
    const newer = new Date(5_000_000);
    await fs.utimes(abs, newer, newer);

    const parsed = await callAndParse();
    expect(parsed.summary.broken).toBe(1);
    const allEntries = parsed.results.flatMap((r: any) => r.entries);
    expect(allEntries.some((e: any) => e.bookmarkId === 'bm1' && e.status === 'broken')).toBe(true);
  });

  it('trusts the cache when neither file nor bookmark changed', async () => {
    // On-disk content is unrelated to the anchor (so it would resolve broken anyway),
    // but the fast path must skip re-read entirely and keep the cached entry.
    const anchorLines = ['one', 'const target = compute();', 'two'];
    const diskLines = ['unrelated', 'disk', 'content'];
    const abs = await writeSource('src/file.ts', diskLines);
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/file.ts', anchorLines, line: 1, updatedAt: 100 },
    ]);
    // discoveredAt NEWER than both file mtime and updatedAt → fast path keeps it.
    await writeCache(
      [{ bookmarkId: 'bm1', uri: 'src/file.ts', status: 'broken', errorCode: 'not_found', errorDetails: null, score: null, discoveredAt: 9_000_000 }],
      ['src/file.ts'],
    );
    const older = new Date(1000);
    await fs.utimes(abs, older, older);

    const parsed = await callAndParse();
    const allEntries = parsed.results.flatMap((r: any) => r.entries);
    expect(allEntries.some((e: any) => e.bookmarkId === 'bm1')).toBe(true);
  });

  it('keeps an entry when the target file is missing', async () => {
    const anchorLines = ['x', 'const target = compute();', 'y'];
    // No source file written to disk at all.
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/missing.ts', anchorLines, line: 1, updatedAt: 500 },
    ]);
    await writeCache(
      [{ bookmarkId: 'bm1', uri: 'src/missing.ts', status: 'broken', errorCode: 'not_found', errorDetails: null, score: null, discoveredAt: 1000 }],
      ['src/missing.ts'],
    );

    const parsed = await callAndParse();
    expect(parsed.summary.broken).toBe(1);
    const allEntries = parsed.results.flatMap((r: any) => r.entries);
    expect(allEntries.some((e: any) => e.bookmarkId === 'bm1')).toBe(true);
  });

  it('reports coverage {covered,total}; covered < total when a registered target is unscanned', async () => {
    const linesA = ['a1', 'const aaa = compute();', 'a3'];
    const linesB = ['b1', 'const bbb = compute();', 'b3'];
    await writeSource('src/a.ts', linesA);
    await writeSource('src/b.ts', linesB);
    await registerBookmarksFile([
      { id: 'bmA', targetRel: 'src/a.ts', anchorLines: linesA, line: 1, updatedAt: 500 },
      { id: 'bmB', targetRel: 'src/b.ts', anchorLines: linesB, line: 1, updatedAt: 500 },
    ]);
    // Only src/a.ts was scanned; src/b.ts is unscanned → covered 1 of 2.
    await writeCache([], ['src/a.ts']);

    const parsed = await callAndParse();
    expect(parsed.summary.coverage.total).toBe(2);
    expect(parsed.summary.coverage.covered).toBe(1);
  });

  it('keeps a cached entry when its data file fails to load (does not drop as bookmark-gone)', async () => {
    const lines = ['line a', 'const target = compute();', 'line c'];
    const abs = await writeSource('src/file.ts', lines);
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/file.ts', anchorLines: lines, line: 1, updatedAt: 500 },
    ]);
    await writeCache(
      [{ bookmarkId: 'bm1', uri: 'src/file.ts', status: 'broken', errorCode: 'not_found', errorDetails: null, score: null, discoveredAt: 1000 }],
      ['src/file.ts'],
    );
    // Corrupt the registered data file so readFileAt throws → loadError=true and bm1 is
    // absent from the index. File mtime > discoveredAt would otherwise force a recheck
    // that resolves against an empty bookmark set and drops bm1. The guard must keep it.
    await fs.writeFile(path.join(testDir, '.bookmarks', 'shared', 'bookmarks.json'), 'not json!!!', 'utf8');
    const newer = new Date(5_000_000);
    await fs.utimes(abs, newer, newer);

    const parsed = await callAndParse();
    expect(parsed.summary.broken).toBe(1);
    const allEntries = parsed.results.flatMap((r: any) => r.entries);
    expect(allEntries.some((e: any) => e.bookmarkId === 'bm1' && e.status === 'broken')).toBe(true);
  });

  it('drops a fast-path entry whose bookmark was deleted (no recheck needed)', async () => {
    const lines = ['line a', 'const target = compute();', 'line c'];
    const abs = await writeSource('src/file.ts', lines);
    // src/file.ts still has a live bookmark (bmKeep), but bm1 was deleted from the data file.
    await registerBookmarksFile([
      { id: 'bmKeep', targetRel: 'src/file.ts', anchorLines: lines, line: 1, updatedAt: 100 },
    ]);
    // The cache still carries a broken entry for the deleted bm1. discoveredAt is newer than
    // both the file mtime and updatedAt → fast path (no recheck). The stale entry for the
    // vanished bookmark must be dropped, not trusted.
    await writeCache(
      [{ bookmarkId: 'bm1', uri: 'src/file.ts', status: 'broken', errorCode: 'not_found', errorDetails: null, score: null, discoveredAt: 9_000_000 }],
      ['src/file.ts'],
    );
    const older = new Date(1000);
    await fs.utimes(abs, older, older);

    const parsed = await callAndParse();
    expect(parsed.summary.broken).toBe(0);
    const allEntries = parsed.results.flatMap((r: any) => r.entries);
    expect(allEntries.some((e: any) => e.bookmarkId === 'bm1')).toBe(false);
  });

  it('keeps a still-broken entry when a sibling data file sharing the URI fails to load', async () => {
    const lines = ['line a', 'const target = compute();', 'line c'];
    const abs = await writeSource('src/file.ts', lines);
    // File A loads fine and also bookmarks src/file.ts, so the URI has an index slot.
    await registerBookmarksFile(
      [{ id: 'bmA', targetRel: 'src/file.ts', anchorLines: lines, line: 1, updatedAt: 500 }],
      'bookmarks-a.json',
    );
    // File B bookmarks the SAME src/file.ts but is corrupt → fails to load (loadError=true),
    // so bmB is absent from the index even though the URI's slot exists (from File A).
    await registerBookmarksFile(
      [{ id: 'bmB', targetRel: 'src/file.ts', anchorLines: lines, line: 1, updatedAt: 500 }],
      'bookmarks-b.json',
    );
    await fs.writeFile(path.join(testDir, '.bookmarks', 'shared', 'bookmarks-b.json'), 'not json!!!', 'utf8');
    // bmB is cached as broken. File mtime > discoveredAt forces a recheck; because bmB lives
    // in the unreadable file it's missing from the resolved set — but with loadError set it
    // must NOT be dropped as "bookmark gone" just because a sibling file kept the slot alive.
    await writeCache(
      [{ bookmarkId: 'bmB', uri: 'src/file.ts', status: 'broken', errorCode: 'not_found', errorDetails: null, score: null, discoveredAt: 1000 }],
      ['src/file.ts'],
    );
    const newer = new Date(5_000_000);
    await fs.utimes(abs, newer, newer);

    const parsed = await callAndParse();
    expect(parsed.summary.broken).toBe(1);
    const allEntries = parsed.results.flatMap((r: any) => r.entries);
    expect(allEntries.some((e: any) => e.bookmarkId === 'bmB' && e.status === 'broken')).toBe(true);
  });

  it('evicts a shared flex-only anchor under enableFlexContextShared:false (isLocal resolution parity with the extension, SML-1508)', async () => {
    // A smart anchor that resolves ONLY via flex (rigid match fails, windowed flex succeeds).
    // The anchor is created with anchorIsLocal:true so it actually carries contextBefore/After
    // (shared creation uses SHARED_CONTEXT_MIN=0 and would capture none). Resolution-time
    // isLocal is independent — it comes from the file living under .bookmarks/shared/ (false).
    const anchorLines = [
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
    const targetIdx = 4;
    // On disk: two non-matching lines inserted on BOTH sides of the target. This breaks the
    // rigid contiguous context match (so Phase-1 resolution fails) but stays within the flex
    // window (so Phase-2 flex resolution succeeds) — i.e. the anchor is flex-only-resolvable.
    const diskLines = [
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
    const abs = await writeSource('src/file.ts', diskLines);
    // registerBookmarksFile writes under .bookmarks/shared/ → the index resolves it as isLocal:false.
    await registerBookmarksFile([
      { id: 'bm1', targetRel: 'src/file.ts', anchorLines, line: targetIdx, updatedAt: 500, anchorIsLocal: true },
    ]);
    // Disable flex for shared anchors. The flex gate is shouldFlex = enableFlex && (isLocal ||
    // enableFlexShared). Pre-fix the server resolves shared anchors with isLocal:false → gate
    // OFF → the flex-only anchor stays broken (kept). The fix resolves with isLocal:true
    // (matching the extension) → gate ON → the anchor resolves → evicted.
    const reg = await readRegistry(testDir);
    reg.settings = reg.settings ?? ({} as any);
    (reg.settings as any).anchors = { ...((reg.settings as any).anchors ?? {}), enableFlexContextShared: false };
    await writeRegistry(testDir, reg);

    await writeCache(
      [{ bookmarkId: 'bm1', uri: 'src/file.ts', status: 'broken', errorCode: 'not_found', errorDetails: null, score: null, discoveredAt: 1000 }],
      ['src/file.ts'],
    );
    // Force a recheck so the resolve path runs (mtimeMs > discoveredAt), not the fast path.
    const newer = new Date(5_000_000);
    await fs.utimes(abs, newer, newer);

    const parsed = await callAndParse();
    expect(parsed.summary.broken).toBe(0);
    const allEntries = parsed.results.flatMap((r: any) => r.entries);
    expect(allEntries.some((e: any) => e.bookmarkId === 'bm1')).toBe(false);
  });
});
