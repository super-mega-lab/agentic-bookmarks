import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createWorkspaceInfo,
  emptyFileV2,
  addFileToRegistry,
  type Bookmark,
} from '@agentic-bookmarks/core';
import { handleGetFileDiff } from './anchor-git-tools';
import { handleAnchorGetFileDiffTool } from './tools/anchor-git';

// ---------------------------------------------------------------------------
// SML-1465 end-to-end: a setter inlined into its caller (declaration deleted,
// body substituted at the call site in the next commit). anchor_getFileDiff
// should diagnose `inlined` instead of a bare `no_match`.
// ---------------------------------------------------------------------------

const REL_PATH = 'src/task-wrapper.ts';
const SETTER_DECL = '  private set promptOutput(output: string) {';
const SETTER_DECL_LINE = 4; // 0-based line of the setter declaration at commit 1

const COMMIT_1 = [
  'export class TaskWrapper {',
  "  private task: { promptOutput$: string } = { promptOutput$: '' };",
  '',
  '  /** Send an output to the output channel as prompt. */',
  '  private set promptOutput(output: string) {',
  '    this.task.promptOutput$ = output;',
  '  }',
  '',
  '  stdout(data: Buffer): void {',
  '    const chunk = data.toString();',
  '    this.promptOutput = chunk;',
  '  }',
  '}',
  '',
].join('\n');

// Setter inlined: declaration removed, call site substituted with the body.
const COMMIT_2 = [
  'export class TaskWrapper {',
  "  private task: { promptOutput$: string } = { promptOutput$: '' };",
  '',
  '  stdout(data: Buffer): void {',
  '    const chunk = data.toString();',
  '    this.task.promptOutput$ = chunk;', // 0-based line 5 -> wire line 6
  '  }',
  '}',
  '',
].join('\n');

const INLINED_LINE_0BASED = 5;

function git(repo: string, cmd: string): void {
  execSync(cmd, { cwd: repo, stdio: 'pipe' });
}

describe('anchor_getFileDiff inline detection (SML-1465)', () => {
  let repoPath: string;

  beforeAll(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'getfilediff-inline-'));
    git(repoPath, 'git init');
    git(repoPath, 'git config user.email "test@test.com"');
    git(repoPath, 'git config user.name "Test User"');

    await fs.mkdir(path.join(repoPath, 'src'), { recursive: true });
    await fs.writeFile(path.join(repoPath, REL_PATH), COMMIT_1);
    git(repoPath, 'git add src/task-wrapper.ts');
    git(repoPath, 'git commit -m "add TaskWrapper with promptOutput setter"');

    await fs.writeFile(path.join(repoPath, REL_PATH), COMMIT_2);
    git(repoPath, 'git add src/task-wrapper.ts');
    git(repoPath, 'git commit -m "inline promptOutput setter into stdout() and remove it"');
  });

  afterAll(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  function makeBookmark(): Bookmark {
    return {
      id: '01INLINE0000000000000000001',
      fileId: '01INLINE0000000000000000002',
      groupId: '01INLINE0000000000000000003',
      target: { uri: REL_PATH },
      anchor: {
        kind: 'smart',
        lineCache: SETTER_DECL,
        lastUpdatedLine: SETTER_DECL_LINE,
        contextBefore: [],
        contextAfter: [],
        nonce: 0,
      },
      label: 'promptOutput setter',
      createdAt: 0,
    } as Bookmark;
  }

  it('diagnoses the inlined setter via handleGetFileDiff (AC4, 0-based internal)', async () => {
    const currentLines = COMMIT_2.split('\n');
    const dataFilePath = path.join(repoPath, '.vscode', 'bookmarks.json');

    const result = await handleGetFileDiff(makeBookmark(), repoPath, REL_PATH, currentLines, dataFilePath);

    expect(result.success).toBe(true);
    expect(result.diagnosis).toBe('inlined');
    const detail = result.detail as any;
    expect(detail.deletedSymbol).toBe('promptOutput');
    expect(detail.deletedBody).toBe('this.task.promptOutput$ = output;');
    expect(detail.inlinedAt.line).toBe(INLINED_LINE_0BASED);
    expect(detail.inlinedAt.confidence).toBe('medium');
    expect(detail.inlinedAt.content).toContain('this.task.promptOutput$ = chunk;');
  });

  it('reports the inlined call site 1-based through the tool wrapper (AC8)', async () => {
    // Register the bookmark in a workspace rooted at the git repo.
    const fileData: any = emptyFileV2({ isLocal: true });
    const absFilePath = path.join(repoPath, '.bookmarks', 'shared', 'shared.json');
    await fs.mkdir(path.dirname(absFilePath), { recursive: true });
    const bm = makeBookmark();
    fileData.bookmarks.push({
      id: bm.id,
      fileId: fileData.fileId,
      groupId: fileData.groups[0].id,
      target: { uri: REL_PATH },
      anchor: bm.anchor,
      label: bm.label,
      createdAt: Date.now(),
    });
    await fs.writeFile(absFilePath, JSON.stringify(fileData, null, 2), 'utf8');
    await addFileToRegistry(repoPath, absFilePath);

    const ctx: any = {
      workspaceRoot: repoPath,
      workspaces: [createWorkspaceInfo(repoPath)],
      lastInitMeta: null,
      lastInitRootUris: undefined,
      hasServedRepairSkillGuide: false,
    };

    const response = await handleAnchorGetFileDiffTool(ctx, { bookmarkId: bm.id });
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.diagnosis).toBe('inlined');
    // 0-based internal line 5 -> 1-based wire line 6.
    expect(parsed.detail.inlinedAt.line).toBe(INLINED_LINE_0BASED + 1);
    expect(parsed.detail.deletedSymbol).toBe('promptOutput');
  });
});
