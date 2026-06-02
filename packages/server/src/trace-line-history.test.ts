import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Bookmark } from '@agentic-bookmarks/core';
import { handleTraceLineHistory } from './anchor-git-tools';

// ---------------------------------------------------------------------------
// Test fixture: small git repo with known commit history
// ---------------------------------------------------------------------------

function makeBookmark(opts: {
  lineCache: string;
  lastUpdatedLine: number;
  contextBefore?: string[];
  contextAfter?: string[];
}): Bookmark {
  return {
    id: '01TRACE00000000000000000001',
    fileId: '01TRACE00000000000000000002',
    groupId: '01TRACE00000000000000000003',
    target: { uri: 'sample.ts' },
    anchor: {
      kind: 'smart',
      lineCache: opts.lineCache,
      lastUpdatedLine: opts.lastUpdatedLine,
      contextBefore: opts.contextBefore ?? [],
      contextAfter: opts.contextAfter ?? [],
      nonce: 0,
    },
    label: 'test',
    createdAt: 0,
  } as Bookmark;
}

describe('handleTraceLineHistory', () => {
  let repoPath: string;
  let commits: string[] = [];

  beforeAll(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-history-test-'));
    execSync('git init', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: repoPath, stdio: 'pipe' });

    // Commit 1: Initial file with 6 lines
    const initial = [
      'function alpha() {',
      '  return 1;',
      '}',
      'function beta() {',
      '  return 2;',
      '}',
    ].join('\n');
    await fs.writeFile(path.join(repoPath, 'sample.ts'), initial);
    execSync('git add sample.ts', { cwd: repoPath, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: repoPath, stdio: 'pipe' });
    commits.push(execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim());

    // Commit 2: Insert 3 lines at top (shifts everything down)
    const shifted = [
      '// Module header',
      '// Version 1.0',
      '',
      'function alpha() {',
      '  return 1;',
      '}',
      'function beta() {',
      '  return 2;',
      '}',
    ].join('\n');
    await fs.writeFile(path.join(repoPath, 'sample.ts'), shifted);
    execSync('git add sample.ts', { cwd: repoPath, stdio: 'pipe' });
    execSync('git commit -m "add header"', { cwd: repoPath, stdio: 'pipe' });
    commits.push(execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim());

    // Commit 3: Delete function beta entirely
    const withoutBeta = [
      '// Module header',
      '// Version 1.0',
      '',
      'function alpha() {',
      '  return 1;',
      '}',
    ].join('\n');
    await fs.writeFile(path.join(repoPath, 'sample.ts'), withoutBeta);
    execSync('git add sample.ts', { cwd: repoPath, stdio: 'pipe' });
    execSync('git commit -m "remove beta"', { cwd: repoPath, stdio: 'pipe' });
    commits.push(execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim());
  });

  afterAll(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it('returns traced with valid newLine for a line still present', async () => {
    // Bookmark on current line 3 ("function alpha()") — blame resolves to commit 1.
    // Since the line hasn't moved since commit 2, trace should show no_history or traced.
    const bookmark = makeBookmark({
      lineCache: 'function alpha() {',
      lastUpdatedLine: 3,
    });

    const currentContent = await fs.readFile(path.join(repoPath, 'sample.ts'), 'utf-8');
    const currentLines = currentContent.split('\n');

    const dataFilePath = path.join(repoPath, '.vscode', 'bookmarks.json');
    const result = await handleTraceLineHistory(bookmark, repoPath, 'sample.ts', currentLines, dataFilePath);
    expect(result.success).toBe(true);
    const r = result.result as any;

    // Should NOT be trace_invalid
    expect(r.status).not.toBe('trace_invalid');

    if (r.status === 'traced') {
      expect(r.newLine).toBeGreaterThanOrEqual(0);
      expect(r.newLine).toBeLessThan(currentLines.length);
    }
  });

  it('returns deleted status with deletedAtCommit and deletedHunk for deleted line', async () => {
    // Bookmark on line 3 ("function beta()") at commit 1.
    // After commit 3, beta was deleted.
    const bookmark = makeBookmark({
      lineCache: 'function beta() {',
      lastUpdatedLine: 3,
    });

    const currentContent = await fs.readFile(path.join(repoPath, 'sample.ts'), 'utf-8');
    const currentLines = currentContent.split('\n');

    const dataFilePath = path.join(repoPath, '.vscode', 'bookmarks.json');
    const result = await handleTraceLineHistory(bookmark, repoPath, 'sample.ts', currentLines, dataFilePath);
    expect(result.success).toBe(true);
    const r = result.result as any;
    expect(r.status).toBe('deleted');

    // Should have deletedAtCommit and deletedAtCommitMessage
    expect(typeof r.deletedAtCommit).toBe('string');
    expect(r.deletedAtCommit.length).toBeGreaterThan(0);
    expect(typeof r.deletedAtCommitMessage).toBe('string');

    // lastSeenLine is the 0-based line beta occupied AFTER the commit-2 header shift,
    // just before deletion in commit 3 — that is 0-based line 6 in commit 2's file.
    // Pinned exactly (not just >= 0) to guard the off-by-one where a 1-based trace
    // lineNumber could leak through unconverted (SML-1468 follow-through refactor).
    expect(r.lastSeenLine).toBe(6);

    // Should include a deletedHunk with the diff context
    expect(r.deletedHunk).not.toBeNull();
    expect(r.deletedHunk.oldRange).toBeDefined();
    expect(r.deletedHunk.newRange).toBeDefined();
    expect(typeof r.deletedHunk.excerpt).toBe('string');
    expect(r.deletedHunk.excerpt.length).toBeGreaterThan(0);
    // The excerpt should contain the deleted line (function beta)
    expect(r.deletedHunk.excerpt).toContain('function beta()');
  });

  it('deleted trace at first commit returns lastSeenLine undefined and includes hunk', async () => {
    // Bookmark on a line that gets deleted in the very first patch after the anchor commit.
    // Since there's no prior trace entry, lastSeenLine should be undefined (not lastUpdatedLine).

    // Create a dedicated repo for this edge case
    const edgeRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-edge-'));
    execSync('git init', { cwd: edgeRepo, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: edgeRepo, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: edgeRepo, stdio: 'pipe' });

    await fs.writeFile(path.join(edgeRepo, 'file.ts'), 'line_a\nline_b\nline_c\n');
    execSync('git add file.ts', { cwd: edgeRepo, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: edgeRepo, stdio: 'pipe' });

    // Delete line_b in next commit
    await fs.writeFile(path.join(edgeRepo, 'file.ts'), 'line_a\nline_c\n');
    execSync('git add file.ts', { cwd: edgeRepo, stdio: 'pipe' });
    execSync('git commit -m "delete line_b"', { cwd: edgeRepo, stdio: 'pipe' });

    const bookmark = makeBookmark({
      lineCache: 'line_b',
      lastUpdatedLine: 1,
    });

    const currentContent = await fs.readFile(path.join(edgeRepo, 'file.ts'), 'utf-8');
    const currentLines = currentContent.split('\n');

    const dataFilePath = path.join(edgeRepo, '.vscode', 'bookmarks.json');
    const result = await handleTraceLineHistory(bookmark, edgeRepo, 'file.ts', currentLines, dataFilePath);
    expect(result.success).toBe(true);
    const r = result.result as any;
    expect(r.status).toBe('deleted');
    // With no prior trace entry (deletedIdx === 0), lastSeenLine must be undefined
    expect(r.lastSeenLine).toBeUndefined();

    // Should still have hunk context
    expect(r.deletedHunk).not.toBeNull();
    expect(r.deletedHunk.excerpt).toContain('line_b');

    await fs.rm(edgeRepo, { recursive: true, force: true });
  });

  it('status is never trace_invalid for normal traced lines', async () => {
    // Bookmark on line 1 ("  return 1;") at commit 1
    const bookmark = makeBookmark({
      lineCache: '  return 1;',
      lastUpdatedLine: 1,
    });

    const currentContent = await fs.readFile(path.join(repoPath, 'sample.ts'), 'utf-8');
    const currentLines = currentContent.split('\n');

    const dataFilePath = path.join(repoPath, '.vscode', 'bookmarks.json');
    const result = await handleTraceLineHistory(bookmark, repoPath, 'sample.ts', currentLines, dataFilePath);
    expect(result.success).toBe(true);
    const r = result.result as any;
    // Should not be trace_invalid for a valid traced line
    expect(r.status).not.toBe('trace_invalid');
  });
});

// ---------------------------------------------------------------------------
// Multi-hop rename tracing (SML-1468)
//
// When the bookmarked line is renamed together with an adjacent line, git
// groups all deletions before all additions in the hunk. Core's tracer then
// sees the bookmarked deletion followed by another deletion and dead-ends at
// `deleted`. handleTraceLineHistory must follow the same-position replacement
// across each commit and reconstruct a `renamed_chain`.
// ---------------------------------------------------------------------------

/** Create a temp git repo, run a callback with its path, then clean it up. */
async function withTempRepo(fn: (repo: string) => Promise<void>): Promise<void> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-multihop-'));
  try {
    execSync('git init', { cwd: repo, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repo, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: repo, stdio: 'pipe' });
    await fn(repo);
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
}

function commitFile(repo: string, relPath: string, lines: string[], message: string): void {
  // Use a trailing newline so the last line is a complete line.
  fsSync.writeFileSync(path.join(repo, relPath), lines.join('\n') + '\n');
  execSync(`git add ${relPath}`, { cwd: repo, stdio: 'pipe' });
  execSync(`git commit -m "${message}"`, { cwd: repo, stdio: 'pipe' });
}

describe('handleTraceLineHistory — multi-hop renames', () => {
  it('traces a grouped two-hop rename to a renamed_chain', async () => {
    await withTempRepo(async (repo) => {
      // Bookmarked signature line + the line below it both rename each hop, so
      // git groups the deletions before the additions (forcing the gap).
      commitFile(repo, 'sample.ts', [
        'function traceRetryAlpha() {',
        '  let counter = 0;',
        '  return counter;',
        '}',
      ], 'add traceRetryAlpha');
      commitFile(repo, 'sample.ts', [
        'function traceRetryBeta() {',
        '  let counterValue = 0;',
        '  return counterValue;',
        '}',
      ], 'rename to traceRetryBeta');
      commitFile(repo, 'sample.ts', [
        'function traceRetryGamma() {',
        '  let counterTotal = 0;',
        '  return counterTotal;',
        '}',
      ], 'rename to traceRetryGamma');

      const bookmark = makeBookmark({
        lineCache: 'function traceRetryAlpha() {',
        lastUpdatedLine: 0,
      });
      const currentLines = (await fs.readFile(path.join(repo, 'sample.ts'), 'utf-8')).split('\n');
      const dataFilePath = path.join(repo, '.vscode', 'bookmarks.json');
      const result = await handleTraceLineHistory(bookmark, repo, 'sample.ts', currentLines, dataFilePath);

      expect(result.success).toBe(true);
      const r = result.result as any;
      expect(r.status).toBe('renamed_chain');
      expect(r.chain.length).toBe(2);
      for (const hop of r.chain) {
        expect(typeof hop.commit).toBe('string');
        expect(hop.commit.length).toBeGreaterThan(0);
        expect(typeof hop.from).toBe('string');
        expect(typeof hop.to).toBe('string');
        expect(typeof hop.commitMessage).toBe('string');
      }
      // Chain reflects the rename progression: alpha -> beta -> gamma.
      expect(r.chain[0].from).toContain('traceRetryAlpha');
      expect(r.chain[0].to).toContain('traceRetryBeta');
      expect(r.chain[1].from).toContain('traceRetryBeta');
      expect(r.chain[1].to).toContain('traceRetryGamma');
    });
  }, 30000);

  it('renamed_chain reports finalLine and finalContent of the resolved line', async () => {
    await withTempRepo(async (repo) => {
      commitFile(repo, 'sample.ts', [
        '// header line one',
        '// header line two',
        'function resolveAlphaOne() {',
        '  let scratch = 0;',
        '  return scratch;',
        '}',
      ], 'add resolveAlphaOne');
      commitFile(repo, 'sample.ts', [
        '// header line one',
        '// header line two',
        'function resolveBetaOne() {',
        '  let scratchValue = 0;',
        '  return scratchValue;',
        '}',
      ], 'rename to resolveBetaOne');

      const bookmark = makeBookmark({
        lineCache: 'function resolveAlphaOne() {',
        lastUpdatedLine: 2,
      });
      const currentLines = (await fs.readFile(path.join(repo, 'sample.ts'), 'utf-8')).split('\n');
      const dataFilePath = path.join(repo, '.vscode', 'bookmarks.json');
      const result = await handleTraceLineHistory(bookmark, repo, 'sample.ts', currentLines, dataFilePath);

      expect(result.success).toBe(true);
      const r = result.result as any;
      expect(r.status).toBe('renamed_chain');
      expect(typeof r.finalLine).toBe('number');
      expect(r.finalLine).toBeGreaterThanOrEqual(0);
      expect(r.finalLine).toBeLessThan(currentLines.length);
      // finalContent is the resolved (0-based) line in the current file.
      expect(r.finalContent).toBe(currentLines[r.finalLine]);
      expect(r.finalContent).toContain('resolveBetaOne');
    });
  }, 30000);

  it('renamed_chain confidence is high for a short chain', async () => {
    await withTempRepo(async (repo) => {
      commitFile(repo, 'sample.ts', [
        'function confAlpha() {',
        '  let token = 0;',
        '  return token;',
        '}',
      ], 'add confAlpha');
      commitFile(repo, 'sample.ts', [
        'function confBeta() {',
        '  let tokenValue = 0;',
        '  return tokenValue;',
        '}',
      ], 'rename to confBeta');
      commitFile(repo, 'sample.ts', [
        'function confGamma() {',
        '  let tokenTotal = 0;',
        '  return tokenTotal;',
        '}',
      ], 'rename to confGamma');

      const bookmark = makeBookmark({
        lineCache: 'function confAlpha() {',
        lastUpdatedLine: 0,
      });
      const currentLines = (await fs.readFile(path.join(repo, 'sample.ts'), 'utf-8')).split('\n');
      const dataFilePath = path.join(repo, '.vscode', 'bookmarks.json');
      const result = await handleTraceLineHistory(bookmark, repo, 'sample.ts', currentLines, dataFilePath);

      expect(result.success).toBe(true);
      const r = result.result as any;
      expect(r.status).toBe('renamed_chain');
      expect(r.chain.length).toBe(2);
      expect(r.confidence).toBe('high');
    });
  }, 30000);

  it('traces a grouped single-hop rename to a renamed_chain', async () => {
    await withTempRepo(async (repo) => {
      commitFile(repo, 'sample.ts', [
        'function singleAlpha() {',
        '  let pending = 0;',
        '  return pending;',
        '}',
      ], 'add singleAlpha');
      commitFile(repo, 'sample.ts', [
        'function singleBeta() {',
        '  let pendingValue = 0;',
        '  return pendingValue;',
        '}',
      ], 'rename to singleBeta');

      const bookmark = makeBookmark({
        lineCache: 'function singleAlpha() {',
        lastUpdatedLine: 0,
      });
      const currentLines = (await fs.readFile(path.join(repo, 'sample.ts'), 'utf-8')).split('\n');
      const dataFilePath = path.join(repo, '.vscode', 'bookmarks.json');
      const result = await handleTraceLineHistory(bookmark, repo, 'sample.ts', currentLines, dataFilePath);

      expect(result.success).toBe(true);
      const r = result.result as any;
      expect(r.status).toBe('renamed_chain');
      expect(r.chain.length).toBe(1);
      expect(r.chain[0].from).toContain('singleAlpha');
      expect(r.chain[0].to).toContain('singleBeta');
      expect(r.confidence).toBe('high');
    });
  }, 30000);

  it('pure deletion in grouped hunk stays deleted', async () => {
    await withTempRepo(async (repo) => {
      // The bookmarked line is removed as part of a grouped change, but it has
      // NO same-position replacement: the block purely shrinks (two adjacent
      // lines deleted, nothing added in their place — the next line is context).
      commitFile(repo, 'sample.ts', [
        'function pureAlpha() {',
        '  const removeMe = computeRetry();',
        '  const alsoGone = secondary();',
        '  return finalResult();',
        '}',
      ], 'add pureAlpha');
      commitFile(repo, 'sample.ts', [
        'function pureAlpha() {',
        '  return finalResult();',
        '}',
      ], 'collapse pureAlpha body');

      const bookmark = makeBookmark({
        lineCache: '  const removeMe = computeRetry();',
        lastUpdatedLine: 1,
      });
      const currentLines = (await fs.readFile(path.join(repo, 'sample.ts'), 'utf-8')).split('\n');
      const dataFilePath = path.join(repo, '.vscode', 'bookmarks.json');
      const result = await handleTraceLineHistory(bookmark, repo, 'sample.ts', currentLines, dataFilePath);

      expect(result.success).toBe(true);
      const r = result.result as any;
      expect(r.status).toBe('deleted');
    });
  }, 30000);

  it('follows a grouped rename that occurs after an unrelated shift commit', async () => {
    // Guards the localDeletedIdx > 0 path: a non-renaming shift commit sits between
    // the baseline and the grouped rename, so the deletion is NOT the first trace
    // entry of the slice. The deleted line and lastSeen line must be read from the
    // (1-based) prior trace entry WITHOUT an off-by-one, or the wrong line is paired
    // as the replacement (SML-1468).
    await withTempRepo(async (repo) => {
      commitFile(repo, 'sample.ts', [
        'function shiftAlpha() {',
        '  let value = 0;',
        '  return value;',
        '}',
      ], 'add shiftAlpha');
      // Shift only — insert two header lines, no rename.
      commitFile(repo, 'sample.ts', [
        '// header one',
        '// header two',
        'function shiftAlpha() {',
        '  let value = 0;',
        '  return value;',
        '}',
      ], 'insert header (shift, no rename)');
      // Grouped rename — signature + body lines change together.
      commitFile(repo, 'sample.ts', [
        '// header one',
        '// header two',
        'function shiftBeta() {',
        '  let valueTotal = 0;',
        '  return valueTotal;',
        '}',
      ], 'rename to shiftBeta');

      const bookmark = makeBookmark({
        lineCache: 'function shiftAlpha() {',
        lastUpdatedLine: 0,
      });
      const currentLines = (await fs.readFile(path.join(repo, 'sample.ts'), 'utf-8')).split('\n');
      const dataFilePath = path.join(repo, '.vscode', 'bookmarks.json');
      const result = await handleTraceLineHistory(bookmark, repo, 'sample.ts', currentLines, dataFilePath);

      expect(result.success).toBe(true);
      const r = result.result as any;
      expect(r.status).toBe('renamed_chain');
      expect(r.chain.length).toBe(1);
      // The hop must pair the SIGNATURE line, not an off-by-one neighbor.
      expect(r.chain[0].from).toContain('shiftAlpha');
      expect(r.chain[0].to).toContain('shiftBeta');
      // Resolves to the signature line in HEAD, not the line below it.
      expect(r.finalContent).toBe(currentLines[r.finalLine]);
      expect(r.finalContent).toContain('shiftBeta');
    });
  }, 30000);
});
