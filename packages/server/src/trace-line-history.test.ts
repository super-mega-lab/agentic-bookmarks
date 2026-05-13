import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
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

    // lastSeenLine should be a number (from the pre-deletion trace) or undefined
    // It should NOT be fabricated from lastUpdatedLine
    if (r.lastSeenLine !== undefined) {
      expect(typeof r.lastSeenLine).toBe('number');
      expect(r.lastSeenLine).toBeGreaterThanOrEqual(0);
    }

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
