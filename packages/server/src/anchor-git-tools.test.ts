import { describe, it, expect, vi } from 'vitest';
import { getRepairSkillGuide, findHistoricalCommit, handleSearchMovedCode } from './anchor-git-tools';

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
  return {
    ...actual,
    readFile: vi.fn().mockResolvedValue('line0\nline1\nline2\nline3\nline4\nline5\n'),
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
